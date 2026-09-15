import { MessageChannel } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { HostRpc } from '../src/host-rpc.ts'
import { MAX_VERSION_RESPONSE_BYTES, checkForDesktopUpdate } from '../src/update-checker.ts'
import { china, desktopPolicy } from './fixtures/desktop-update-policy.ts'
import { bindNativeRuntime, createHostRuntime, runtimeSnapshot } from '../src/host-runtime-bridge.ts'
import type { DesktopRuntime, DesktopShellSpec, DesktopTrayItem } from '../src/runtime.ts'

it('preserves the Web URL and authentication while projecting shell and tray callbacks', async () => {
  const { port1, port2 } = new MessageChannel()
  const [parent, child] = [port1, port2].map(port => new HostRpc({
    send: value => port.postMessage(value),
    listen: receive => { port.on('message', receive); return () => { port.off('message', receive) } },
  })) as [HostRpc, HostRpc]
  let shell!: DesktopShellSpec
  let tray!: DesktopTrayItem
  const disposeShell = vi.fn(async () => {})
  const disposeTray = vi.fn()
  const native = {
    platform: 'win32', windowsBuild: 22631, locale: 'en',
    updates: { isPackaged: true, canDownload: true, currentVersion: '2.0.7-beta.1', statePath: '/tmp/update',
      request: vi.fn(async () => new Response('{"version":"2.0.8-beta.1"}', { headers: { 'x-test': 'yes' } })),
    },
    schedule: (value: DesktopShellSpec) => { shell = value; return disposeShell },
    registerTrayItem: (value: DesktopTrayItem) => { tray = value; return { refresh() {}, dispose: disposeTray } },
  } as unknown as DesktopRuntime
  const release = bindNativeRuntime(parent, native)
  try {
    const runtime = createHostRuntime(child, runtimeSnapshot(native))
    let language: 'zh' | undefined
    const mode = vi.fn(async () => {})
    const invoke = vi.fn(async () => {})
    const spec = { url: 'http://127.0.0.1:1234/?dsh-desktop-mode=advanced',
      authenticationUrl: 'http://127.0.0.1:1234/?token=fixture',
      rendererAccessHeader: { name: 'x-dsh-desktop-renderer', value: 'fixture' },
      readLocalePreference: () => language, readThemeSource: () => 'dark',
      requestQuit() {}, requestModeChange: mode,
    } as unknown as DesktopShellSpec
    spec.readRemoteControl = vi.fn(async () => false)
    spec.enableRemoteControl = vi.fn(async () => {})
    const stopShell = runtime.schedule(spec)
    runtime.registerTrayItem({ group: 'tools', order: 1, label: () => 'Plugin action', invoke,
      submenu: () => [{ label: () => 'Child', invoke }] })
    language = 'zh'
    await runtime.mountScheduled()
    expect(await shell.readRemoteControl?.()).toBe(false)
    await shell.enableRemoteControl?.()
    expect(spec.enableRemoteControl).toHaveBeenCalledTimes(1)
    expect(shell.url).toBe(spec.url)
    expect(shell.authenticationUrl).toBe(spec.authenticationUrl)
    expect(shell.rendererAccessHeader).toEqual(spec.rendererAccessHeader)
    expect(shell.readLocalePreference()).toBe('zh')
    await shell.requestModeChange('extended')
    expect(mode).toHaveBeenCalledWith('extended')
    expect(tray.label()).toBe('Plugin action')
    await tray.submenu?.()[0]?.invoke()
    expect(invoke).toHaveBeenCalledOnce()
    const response = await runtime.updates.request('https://example.invalid', { headers: { accept: 'application/json' } })
    expect(response.headers.get('x-test')).toBe('yes')
    expect(await response.json()).toEqual({ version: '2.0.8-beta.1' })
    await stopShell()
    expect(disposeShell).toHaveBeenCalledOnce()
  } finally { await release(); parent.close(); child.close(); port1.close(); port2.close() }
})


it('checks tenant generation through the real Host channel after a native dialog is already open', async () => {
  const { port1, port2 } = new MessageChannel()
  const [parent, child] = [port1, port2].map(port => new HostRpc({
    send: value => port.postMessage(value),
    listen: receive => { port.on('message', receive); return () => { port.off('message', receive) } },
  })) as [HostRpc, HostRpc]
  let guard!: () => boolean | Promise<boolean>
  let dismiss!: () => void
  let generation = 1
  const native = { platform: 'darwin', locale: 'en', updates: {
    isPackaged: true, canDownload: false, currentVersion: '2.2.1', statePath: '/tmp/tenant-updates',
    showManualCheckResult: async (_result: unknown, isCurrent: typeof guard) => {
      guard = isCurrent
      await new Promise<void>(resolve => { dismiss = resolve })
    },
  } } as unknown as DesktopRuntime
  const release = bindNativeRuntime(parent, native)
  try {
    const runtime = createHostRuntime(child, runtimeSnapshot(native))
    const dialog = runtime.updates.showManualCheckResult({ status: 'update-available',
      currentVersion: '2.2.1', latestVersion: '2.2.2', downloadPageUrl: 'https://awiki.ai/downloads/dsh-awiki/' },
    () => generation === 1)
    await vi.waitFor(() => expect(guard).toBeTypeOf('function'))
    expect(await guard()).toBe(true)
    generation = 2
    expect(await guard()).toBe(false)
    dismiss()
    await dialog
    // The completed dialog cannot retain a callable Host guard.
    expect(await guard()).toBe(false)
  } finally { dismiss?.(); await release(); parent.close(); child.close(); port1.close(); port2.close() }
})


it('preserves policy response origins and rejects oversized replies before crossing the Host bridge', async () => {
  const { port1, port2 } = new MessageChannel()
  const [parent, child] = [port1, port2].map(port => new HostRpc({
    send: value => port.postMessage(value),
    listen: receive => { port.on('message', receive); return () => { port.off('message', receive) } },
  })) as [HostRpc, HostRpc]
  const request = vi.fn(async () => Response.json(desktopPolicy(china.policyOrigin, ['2.2.2'])))
  const native = { platform: 'darwin', locale: 'en', updates: {
    isPackaged: true, canDownload: false, currentVersion: '2.2.1', statePath: '/tmp/tenant-updates', request,
  } } as unknown as DesktopRuntime
  const release = bindNativeRuntime(parent, native)
  try {
    const runtime = createHostRuntime(child, runtimeSnapshot(native))
    const check = () => checkForDesktopUpdate({ currentVersion: '2.2.1', tenant: china, request: runtime.updates.request })
    expect(await check()).toMatchObject({ status: 'update-available', latestVersion: '2.2.2' })
    for (const metadata of [{ url: 'https://foreign.example/policy', redirected: false },
      { url: `${china.policyOrigin}/policy`, redirected: true }]) {
      request.mockImplementation(async () => {
        const response = Response.json(desktopPolicy(china.policyOrigin, ['9.0.0']))
        Object.defineProperties(response, { url: { value: metadata.url }, redirected: { value: metadata.redirected } })
        return response
      })
      expect(await check()).toBeNull()
    }
    const cancel = vi.fn()
    request.mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_VERSION_RESPONSE_BYTES + 1)) }, cancel,
    })))
    expect(await check()).toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
  } finally { await release(); parent.close(); child.close(); port1.close(); port2.close() }
})
