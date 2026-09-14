import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDesktopUpdateLifecycle } from '../src/update-lifecycle.ts'
import type { DesktopTrayItem, DesktopUpdateAdapter } from '../src/runtime.ts'
import { DESKTOP_DISTRIBUTION_ID } from '../src/distribution.ts'
import { apply, Config } from '../src/updates.ts'
import { Context } from '@deepseek-ai/cordis'

import { china, globalTenant, desktopPolicy } from './fixtures/desktop-update-policy.ts'
const DESKTOP_DOWNLOAD_PAGE = `${china.policyOrigin}/downloads/dsh-awiki/`

const disposers: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); vi.useRealTimers() })
function release(version = '2.1.0', origin = china.policyOrigin) { return Response.json(desktopPolicy(origin, [version])) }
async function harness(request = vi.fn(async () => release()), packaged = false) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-update-test-'))
  let tray!: DesktopTrayItem
  const notify = vi.fn()
  const showManualCheckResult = vi.fn<DesktopUpdateAdapter['showManualCheckResult']>(async () => {})
  const remove = vi.fn()
  const adapter: DesktopUpdateAdapter = { isPackaged: packaged, currentVersion: '2.1.0-rc.7',
    statePath: join(root, 'state.json'), request, notify, showManualCheckResult }
  const owner = startDesktopUpdateLifecycle({ adapter,
    policy: { enabled: true, initialDelayMs: 10, intervalMs: 1000, requestTimeoutMs: 100 }, locale: () => 'zh',
    registerTrayItem: item => { tray = item; return { refresh: vi.fn(), dispose: remove } } })
  owner.setTenant(china)
  await new Promise(resolve => setImmediate(resolve))
  disposers.push(async () => { await owner.dispose(); await rm(root, { recursive: true, force: true }) })
  return { owner, tray, request, notify, showManualCheckResult, remove, adapter, root }
}
describe('lightweight Desktop update lifecycle', () => {
  it('discards late results after A to B to A and clears old download links immediately', async () => {
    let resolve!: (value: Response) => void
    const h = await harness(vi.fn(() => new Promise<Response>(done => { resolve = done })))
    const old = h.owner.check()
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce())
    h.owner.setTenant(globalTenant)
    expect(h.owner.getSnapshot().downloadPageUrl).toBeUndefined()
    h.owner.setTenant({ ...china, tenantGeneration: 2 })
    h.request.mockImplementation(async () => release('2.2.0'))
    await h.owner.check()
    resolve(release('9.0.0'))
    await old
    expect(h.owner.getSnapshot()).toMatchObject({ tenantId: china.tenantId, tenantGeneration: 2, latestVersion: '2.2.0' })
    expect(h.notify).not.toHaveBeenCalled()
  })
  it('restores only the selected tenant cache and refuses revision regression', async () => {
    const h = await harness()
    h.request.mockImplementation(async () => Response.json(desktopPolicy(china.policyOrigin, ['2.2.0'], 3)))
    await h.owner.check()
    h.owner.setTenant(globalTenant)
    h.request.mockRejectedValue(new Error('offline'))
    expect(await h.owner.check()).toMatchObject({ state: 'failed', usedCache: false })
    h.owner.setTenant({ ...china, tenantGeneration: 2 })
    expect(await h.owner.check()).toMatchObject({ state: 'failed', usedCache: true, latestVersion: '2.2.0', policyRevision: 3 })
    h.request.mockImplementation(async () => Response.json(desktopPolicy(china.policyOrigin, ['9.0.0'], 2)))
    expect(await h.owner.check()).toMatchObject({ state: 'failed', latestVersion: '2.2.0', policyRevision: 3 })
  })
  it('prevents an already-open manual dialog from opening the former tenant page', async () => {
    const h = await harness()
    await h.tray.invoke()
    const guard = h.showManualCheckResult.mock.calls[0]?.[1] as unknown as () => boolean
    expect(guard()).toBe(true)
    h.owner.setTenant(globalTenant)
    expect(guard()).toBe(false)
  })
  it('exposes the same optional service used by the tray and cleans it up', async () => {
    const h = await harness()
    let cleanup!: () => Promise<void>
    const remove = vi.fn()
    const provide = vi.fn((_name: string, _service: unknown) => remove)
    apply({ desktopRuntime: { updates: h.adapter, locale: 'en', registerTrayItem: () => ({ refresh() {}, dispose() {} }) },
      inject: () => {}, provide, effect: (fn: () => () => Promise<void>) => { cleanup = fn() } } as unknown as Context,
    Config({ enabled: false } as never))
    const service = provide.mock.calls[0]?.[1] as unknown as typeof h.owner
    expect(provide.mock.calls[0]?.[0]).toBe('desktopDistribution')
    expect(service.getSnapshot().distributionId).toBe(DESKTOP_DISTRIBUTION_ID)
    await cleanup()
    expect(remove).toHaveBeenCalledOnce()
  })
  it('binds and removes a late AWiki capability through the real Cordis lifecycle', async () => {
    const h = await harness()
    const ctx = new Context()
    ctx.provide('desktopRuntime', { updates: h.adapter, locale: 'en',
      registerTrayItem: () => ({ refresh() {}, dispose() {} }) } as never)
    const fiber = await ctx.plugin({ name: 'desktop-updates-test', inject: ['desktopRuntime'], apply }, Config({ enabled: false } as never))
    const unregister = vi.fn()
    try {
      expect(ctx.desktopDistribution.getSnapshot().state).toBe('unavailable')
      const remove = ctx.provide('awiki', { getTenantRegistryView: () => ({ activeTenantId: china.tenantId,
        generation: 0, tenants: [{ tenantId: china.tenantId, backendBaseUrl: china.policyOrigin }] }),
        registerTenantLifecycleParticipant: () => unregister })
      await vi.waitFor(() => expect(ctx.desktopDistribution.getSnapshot().tenantId).toBe(china.tenantId))
      await remove()
      await vi.waitFor(() => expect(ctx.desktopDistribution.getSnapshot().state).toBe('unavailable'))
      expect(unregister).toHaveBeenCalledOnce()
    } finally { await fiber.dispose() }
  })
  it('binds the optional AWiki owner and participates in commit, rollback and disposal', async () => {
    const h = await harness()
    let service!: typeof h.owner
    let cleanup!: () => Promise<void>
    let tenantCleanup!: () => void
    let participant!: { prepareSwitch(): void; commitSwitch(context: unknown): void; rollbackSwitch(context: unknown): void }
    const unregister = vi.fn()
    const owner = { getTenantRegistryView: () => ({ activeTenantId: 'global', generation: 4,
      tenants: [{ tenantId: 'global', backendBaseUrl: globalTenant.policyOrigin }] }),
      registerTenantLifecycleParticipant: (value: typeof participant) => { participant = value; return unregister } }
    apply({ desktopRuntime: { updates: h.adapter, locale: 'en', registerTrayItem: () => ({ refresh() {}, dispose() {} }) },
      provide: (_name: string, value: typeof service) => { service = value; return () => {} },
      inject: (_names: string[], callback: (ctx: unknown) => void) => callback({ get: () => owner,
        effect: (fn: () => () => void) => { tenantCleanup = fn() } }),
      effect: (fn: () => () => Promise<void>) => { cleanup = fn() } } as unknown as Context,
    Config({ enabled: false } as never))
    expect(service.getSnapshot()).toMatchObject({ tenantId: 'global', tenantGeneration: 4 })
    const context = { from: { tenantId: 'global', backendBaseUrl: globalTenant.policyOrigin },
      to: { tenantId: 'china', backendBaseUrl: china.policyOrigin }, generation: 5 }
    participant.prepareSwitch()
    expect(service.getSnapshot()).toMatchObject({ state: 'unavailable' })
    participant.commitSwitch(context)
    expect(service.getSnapshot()).toMatchObject({ tenantId: 'china', tenantGeneration: 5 })
    participant.rollbackSwitch(context)
    expect(service.getSnapshot()).toMatchObject({ tenantId: 'global', tenantGeneration: 5 })
    tenantCleanup()
    expect(unregister).toHaveBeenCalledOnce()
    expect(service.getSnapshot().state).toBe('unavailable')
    await cleanup()
  })
  it('honors an explicit tenant withdrawal and does not revive its cached update after returning to that tenant', async () => {
    const h = await harness()
    await h.owner.check()
    const body = desktopPolicy(china.policyOrigin, ['2.1.0'], 2)
    body.client_versions.products.dsh.desktop.enabled = false
    h.request.mockImplementation(async () => Response.json(body))
    expect(await h.owner.check()).toMatchObject({ state: 'unavailable', updateAvailable: false, policyRevision: 2 })
    h.owner.setTenant(globalTenant)
    h.owner.setTenant({ ...china, tenantGeneration: 3 })
    h.request.mockRejectedValue(new Error('offline'))
    expect(await h.owner.check()).toMatchObject({ state: 'failed', updateAvailable: false, usedCache: true, policyRevision: 2 })
    expect(h.owner.getSnapshot().downloadPageUrl).toBeUndefined()
  })
  it('coalesces settings and tray checks and never downloads an installer', async () => {
    let resolve!: (value: Response) => void
    const h = await harness(vi.fn(() => new Promise<Response>(done => { resolve = done })))
    const changed = vi.fn(); h.owner.subscribe(changed)
    const check = h.owner.check()
    const manual = h.tray.invoke()
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledOnce())
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const h = await harness(vi.fn(() => new Promise<Response>(() => {})))
    const check = h.owner.check()
    await vi.waitFor(() => expect(h.owner.getSnapshot().state).toBe('checking'))
    await vi.advanceTimersByTimeAsync(101)
    expect(await check).toMatchObject({ state: 'failed' })
    const next = h.owner.check()
    await h.owner.dispose()
    await next
    expect(h.remove).toHaveBeenCalledOnce()
  })
  it('uses one nonblocking notification per version and persists channel-scoped history', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const h = await harness(undefined, true)
    await vi.advanceTimersByTimeAsync(10)
    await vi.waitFor(() => expect(h.notify).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.notify).toHaveBeenCalledOnce()
    expect(h.showManualCheckResult).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(h.root, (await readdir(h.root)).find(name => name.startsWith('state.json.'))!), 'utf8'))).toMatchObject({ version: 4, tenantId: china.tenantId, policyOrigin: china.policyOrigin, channel: 'prerelease', lastPromptedVersion: '2.1.0' })
  })
})
