import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDesktopUpdateLifecycle } from '../src/update-lifecycle.ts'
import type { DesktopTrayItem, DesktopUpdateAdapter } from '../src/runtime.ts'
import { DESKTOP_DISTRIBUTION_ID, DESKTOP_DOWNLOAD_PAGE } from '../src/distribution.ts'
import { apply, Config } from '../src/updates.ts'
import type { Context } from '@deepseek-ai/cordis'

const disposers: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); vi.useRealTimers() })
function release(version = '2.1.0') { return Response.json({ schema_version: 1, product: 'dsh-desktop', channel: version.includes('-') ? 'prerelease' : 'stable', version }) }
async function harness(request = vi.fn(async () => release()), packaged = false) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-update-test-'))
  let tray!: DesktopTrayItem
  const notify = vi.fn()
  const showManualCheckResult = vi.fn(async () => {})
  const remove = vi.fn()
  const adapter: DesktopUpdateAdapter = { isPackaged: packaged, currentVersion: '2.1.0-rc.7',
    statePath: join(root, 'state.json'), request, notify, showManualCheckResult }
  const owner = startDesktopUpdateLifecycle({ adapter,
    policy: { enabled: true, initialDelayMs: 10, intervalMs: 1000, requestTimeoutMs: 100 }, locale: () => 'zh',
    registerTrayItem: item => { tray = item; return { refresh: vi.fn(), dispose: remove } } })
  disposers.push(async () => { await owner.dispose(); await rm(root, { recursive: true, force: true }) })
  return { owner, tray, request, notify, showManualCheckResult, remove, adapter }
}
describe('lightweight Desktop update lifecycle', () => {
  it('exposes the same optional service used by the tray and cleans it up', async () => {
    const h = await harness()
    let cleanup!: () => Promise<void>
    const remove = vi.fn()
    const provide = vi.fn((_name: string, _service: unknown) => remove)
    apply({ desktopRuntime: { updates: h.adapter, locale: 'en', registerTrayItem: () => ({ refresh() {}, dispose() {} }) },
      provide, effect: (fn: () => () => Promise<void>) => { cleanup = fn() } } as unknown as Context,
    Config({ enabled: false } as never))
    const service = provide.mock.calls[0]?.[1] as unknown as typeof h.owner
    expect(provide.mock.calls[0]?.[0]).toBe('desktopDistribution')
    expect(service.getSnapshot().distributionId).toBe(DESKTOP_DISTRIBUTION_ID)
    await cleanup()
    expect(remove).toHaveBeenCalledOnce()
  })
  it('coalesces settings and tray checks and never downloads an installer', async () => {
    let resolve!: (value: Response) => void
    const h = await harness(vi.fn(() => new Promise<Response>(done => { resolve = done })))
    const changed = vi.fn(); h.owner.subscribe(changed)
    const check = h.owner.check()
    const manual = h.tray.invoke()
    expect(h.request).toHaveBeenCalledOnce()
    expect(h.owner.getSnapshot().state).toBe('checking')
    resolve(release())
    await check; await manual
    expect(h.owner.getSnapshot()).toMatchObject({ state: 'ready', updateAvailable: true, latestVersion: '2.1.0', downloadPageUrl: DESKTOP_DOWNLOAD_PAGE })
    expect(changed).toHaveBeenCalled()
    expect(h.showManualCheckResult).toHaveBeenCalledOnce()
    expect(h.request).toHaveBeenCalledOnce()
    expect(h.notify).not.toHaveBeenCalled()
  })
  it('preserves the last successful result and page on failure', async () => {
    const h = await harness()
    await h.owner.check()
    h.request.mockRejectedValueOnce(new Error('offline'))
    expect(await h.owner.check()).toMatchObject({ state: 'failed', usedCache: true, latestVersion: '2.1.0', downloadPageUrl: DESKTOP_DOWNLOAD_PAGE })
  })
  it('bounds a stalled adapter and cancels promptly during disposal', async () => {
    vi.useFakeTimers()
    const h = await harness(vi.fn(() => new Promise<Response>(() => {})))
    const check = h.owner.check()
    await vi.advanceTimersByTimeAsync(101)
    expect(await check).toMatchObject({ state: 'failed' })
    const next = h.owner.check()
    await h.owner.dispose()
    await next
    expect(h.remove).toHaveBeenCalledOnce()
  })
  it('uses one nonblocking notification per version and persists channel-scoped history', async () => {
    vi.useFakeTimers()
    const h = await harness(undefined, true)
    await vi.advanceTimersByTimeAsync(10)
    await vi.waitFor(() => expect(h.notify).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.notify).toHaveBeenCalledOnce()
    expect(h.showManualCheckResult).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(h.adapter.statePath, 'utf8'))).toMatchObject({ version: 3, distributionId: DESKTOP_DISTRIBUTION_ID, channel: 'prerelease', lastPromptedVersion: '2.1.0' })
  })
})
