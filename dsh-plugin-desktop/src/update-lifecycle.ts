/** Tenant-scoped checks, cached policy and manual Desktop installation guidance. */
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { checkForDesktopUpdate, parseDesktopPolicy, parseSemVer, type UpdateCheckResult } from './update-checker.ts'
import { DESKTOP_DISTRIBUTION_ID, type DesktopTenantContext, type DesktopDistribution, type DesktopDistributionSnapshot } from './distribution.ts'
import { desktopTrayLabel } from './tray-locale.ts'
import type { DesktopLocale, DesktopTrayItem, DesktopTrayItemRegistration, DesktopUpdateAdapter } from './runtime.ts'
import type { Config } from './updates.ts'

export interface DesktopUpdateLifecycle extends DesktopDistribution { dispose(): Promise<void> }
export interface DesktopUpdateLifecycleOptions {
  readonly adapter: DesktopUpdateAdapter
  readonly policy: Config
  readonly locale: () => DesktopLocale
  readonly registerTrayItem: (item: DesktopTrayItem) => DesktopTrayItemRegistration
}
export function startDesktopUpdateLifecycle(options: DesktopUpdateLifecycleOptions): DesktopUpdateLifecycle {
  return new UpdateLifecycle(options)
}
class UpdateLifecycle implements DesktopUpdateLifecycle {
  private snapshot: DesktopDistributionSnapshot
  private tenant: DesktopTenantContext | undefined
  private epoch = 0
  private readonly listeners = new Set<() => void>()
  private readonly registration: DesktopTrayItemRegistration
  private stateReady: Promise<void> = Promise.resolve()
  private writes: Promise<void> = Promise.resolve()
  private lastPromptedVersion: string | undefined
  private cachedPolicy: string | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private controller: AbortController | undefined
  private task: Promise<DesktopDistributionSnapshot> | undefined
  private manualTask: Promise<void> | undefined
  private disposed = false

  constructor(private readonly options: DesktopUpdateLifecycleOptions) {
    this.snapshot = this.emptySnapshot()
    this.registration = options.registerTrayItem({ group: 'tools', order: 10,
      label: () => this.snapshot.state === 'checking' ? desktopTrayLabel(options.locale(), 'checkingForUpdates')
        : this.snapshot.updateAvailable ? desktopTrayLabel(options.locale(), 'updateAvailable', this.snapshot.latestVersion!)
          : desktopTrayLabel(options.locale(), 'checkForUpdates'), invoke: () => this.manualCheck() })
    if (options.adapter.isPackaged && options.policy.enabled) this.schedule(options.policy.initialDelayMs)
  }
  private emptySnapshot(): DesktopDistributionSnapshot {
    return { schemaVersion: 2, distributionId: DESKTOP_DISTRIBUTION_ID, currentVersion: this.options.adapter.currentVersion,
      channel: (parseSemVer(this.options.adapter.currentVersion)?.prerelease.length ?? 0) > 0 ? 'prerelease' : 'stable',
      ...this.tenant, state: this.tenant === undefined ? 'unavailable' : 'unchecked', updateAvailable: false, usedCache: false }
  }
  setTenant(tenant: DesktopTenantContext | undefined): void {
    if (this.disposed) return
    if (tenant !== undefined) {
      try {
        const origin = new URL(tenant.policyOrigin)
        if (origin.protocol !== 'https:' || origin.origin !== tenant.policyOrigin || tenant.tenantId.length === 0
          || !Number.isSafeInteger(tenant.tenantGeneration) || tenant.tenantGeneration < 0) tenant = undefined
      } catch { tenant = undefined }
    }
    if (JSON.stringify(tenant) === JSON.stringify(this.tenant)) return
    this.epoch++
    this.controller?.abort()
    this.task = undefined
    this.manualTask = undefined
    this.tenant = tenant === undefined ? undefined : { ...tenant }
    this.lastPromptedVersion = undefined
    this.cachedPolicy = undefined
    this.publish(this.emptySnapshot())
    this.stateReady = this.loadCache(this.epoch)
  }
  getSnapshot(): DesktopDistributionSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(snapshot: DesktopDistributionSnapshot): void {
    if (this.disposed) return
    this.snapshot = snapshot
    this.registration.refresh()
    for (const listener of this.listeners) { try { listener() } catch { /* Isolate subscribers. */ } }
  }
  private fromResult(result: UpdateCheckResult, usedCache: boolean, checkedAt: string): DesktopDistributionSnapshot {
    return { ...this.emptySnapshot(), state: result.status === 'unavailable' ? 'unavailable' : 'ready',
      usedCache, checkedAt, ...(result.policyRevision === undefined ? {} : { policyRevision: result.policyRevision }),
      ...(result.downloadPageUrl === undefined ? {} : { downloadPageUrl: result.downloadPageUrl }),
      latestVersion: result.latestVersion, updateAvailable: result.status === 'update-available', noRelease: result.status === 'no-release',
      ...(result.bundledVersions === undefined ? {} : { bundledVersions: result.bundledVersions }) }
  }
  check(): Promise<DesktopDistributionSnapshot> {
    if (this.disposed || this.tenant === undefined) return Promise.resolve(this.snapshot)
    if (this.task !== undefined) return this.task
    const epoch = this.epoch
    const tenant = this.tenant
    const task = (async () => {
      await this.stateReady
      if (epoch !== this.epoch || this.disposed) return this.snapshot
      this.publish({ ...this.snapshot, state: 'checking' })
      const controller = new AbortController()
      this.controller = controller
      const timeout = setTimeout(() => { controller.abort() }, this.options.policy.requestTimeoutMs)
      let abort!: () => void
      const aborted = new Promise<null>(resolve => {
        abort = () => { resolve(null) }
        controller.signal.addEventListener('abort', abort, { once: true })
      })
      try {
        const result = await Promise.race([aborted, checkForDesktopUpdate({ currentVersion: this.snapshot.currentVersion,
          tenant, ...(this.snapshot.policyRevision === undefined ? {} : { minimumRevision: this.snapshot.policyRevision }), request: this.options.adapter.request,
          signal: controller.signal }).catch(() => null)])
        if (epoch !== this.epoch || this.disposed) return this.snapshot
        if (result === null) this.publish({ ...this.snapshot, state: 'failed', usedCache: this.cachedPolicy !== undefined })
        else {
          this.cachedPolicy = result.policy
          this.publish(this.fromResult(result, false, new Date().toISOString()))
          await this.saveCache()
        }
        return this.snapshot
      } finally {
        clearTimeout(timeout)
        controller.signal.removeEventListener('abort', abort)
        if (this.controller === controller) this.controller = undefined
      }
    })().finally(() => { if (this.task === task) this.task = undefined })
    this.task = task
    return task
  }
  private manualCheck(): Promise<void> {
    if (this.manualTask !== undefined) return this.manualTask
    const epoch = this.epoch
    const task = (async () => {
      const snapshot = await this.check()
      if (this.disposed || epoch !== this.epoch) return
      const result: UpdateCheckResult | null = snapshot.state === 'failed' ? null : {
        status: snapshot.state === 'unavailable' ? 'unavailable' : snapshot.noRelease ? 'no-release'
          : snapshot.updateAvailable ? 'update-available' : 'up-to-date',
        currentVersion: snapshot.currentVersion, latestVersion: snapshot.latestVersion ?? snapshot.currentVersion,
        ...(snapshot.downloadPageUrl === undefined ? {} : { downloadPageUrl: snapshot.downloadPageUrl }) }
      await this.options.adapter.showManualCheckResult(result, () => epoch === this.epoch && !this.disposed)
    })().catch(() => {}).finally(() => { if (this.manualTask === task) this.manualTask = undefined })
    this.manualTask = task
    return task
  }
  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      void this.backgroundCheck().catch(() => {}).finally(() => {
        if (!this.disposed) this.schedule(this.options.policy.intervalMs)
      })
    }, delay)
  }
  private async backgroundCheck(): Promise<void> {
    const epoch = this.epoch
    const snapshot = await this.check()
    if (epoch !== this.epoch || this.disposed || snapshot.state !== 'ready' || !snapshot.updateAvailable
      || this.lastPromptedVersion === snapshot.latestVersion) return
    this.lastPromptedVersion = snapshot.latestVersion
    await this.saveCache()
    if (epoch !== this.epoch || this.disposed) return
    const zh = this.options.locale() === 'zh'
    this.options.adapter.notify({ title: zh ? 'DSH Desktop 有新版本' : 'DSH Desktop update available',
      body: zh ? '可在设置或托盘中查看当前租户的版本并前往下载页面。' : 'Check Settings or the tray for this tenant’s download page.' })
  }
  private cachePath(): string | undefined {
    if (this.tenant === undefined) return undefined
    const key = createHash('sha256').update(JSON.stringify([this.tenant.tenantId, this.tenant.policyOrigin,
      DESKTOP_DISTRIBUTION_ID, this.snapshot.channel])).digest('hex')
    return `${this.options.adapter.statePath}.${key}`
  }
  private async loadCache(epoch: number): Promise<void> {
    const path = this.cachePath()
    const tenant = this.tenant
    if (path === undefined || tenant === undefined) return
    try {
      await this.writes
      const file = await open(path, 'r')
      let content: string
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > 192 * 1024) return
        const bytes = Buffer.alloc(192 * 1024 + 1)
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
        if (bytesRead > 192 * 1024) return
        content = bytes.subarray(0, bytesRead).toString('utf8')
      } finally { await file.close() }
      const state = JSON.parse(content) as Record<string, unknown>
      if (state.version !== 4 || state.tenantId !== tenant.tenantId || state.policyOrigin !== tenant.policyOrigin
        || state.channel !== this.snapshot.channel || typeof state.policy !== 'string'
        || typeof state.checkedAt !== 'string' || !Number.isFinite(Date.parse(state.checkedAt))) return
      const result = parseDesktopPolicy(state.policy, { currentVersion: this.snapshot.currentVersion, tenant })
      if (result === null || epoch !== this.epoch || this.disposed) return
      this.cachedPolicy = state.policy
      if (typeof state.lastPromptedVersion === 'string' && parseSemVer(state.lastPromptedVersion) !== null) this.lastPromptedVersion = state.lastPromptedVersion
      this.publish(this.fromResult(result, true, state.checkedAt))
    } catch { /* Missing or invalid cache is a normal first check. */ }
  }
  private saveCache(): Promise<void> {
    const path = this.cachePath()
    if (path === undefined || this.cachedPolicy === undefined) return Promise.resolve()
    const data = JSON.stringify({ version: 4, ...this.tenant, channel: this.snapshot.channel,
      checkedAt: this.snapshot.checkedAt, policy: this.cachedPolicy, lastPromptedVersion: this.lastPromptedVersion }) + '\n'
    this.writes = this.writes.then(() => writeFileAtomic(path, data, { mode: 0o600, dirMode: 0o700 })).catch(() => {})
    return this.writes
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.controller?.abort()
    this.listeners.clear()
    this.registration.dispose()
    await Promise.allSettled([this.stateReady, this.task, this.writes])
  }
}
