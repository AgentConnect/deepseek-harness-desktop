/** One generation owns shared release checks, lightweight notifications and disposal. */
import { open } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { checkForDesktopUpdate, parseSemVer, type UpdateCheckResult } from './update-checker.ts'
import { DESKTOP_DISTRIBUTION_ID, DESKTOP_DOWNLOAD_PAGE, type DesktopDistribution, type DesktopDistributionSnapshot } from './distribution.ts'
import { desktopTrayLabel } from './tray-locale.ts'
import type { DesktopLocale, DesktopTrayItem, DesktopTrayItemRegistration, DesktopUpdateAdapter } from './runtime.ts'
import type { Config } from './updates.ts'

export interface DesktopUpdateLifecycle extends DesktopDistribution {
  dispose(): Promise<void>
}
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
  private readonly listeners = new Set<() => void>()
  private readonly registration: DesktopTrayItemRegistration
  private readonly stateReady: Promise<void>
  private lastPromptedVersion: string | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private requestTimer: ReturnType<typeof setTimeout> | undefined
  private controller: AbortController | undefined
  private task: Promise<DesktopDistributionSnapshot> | undefined
  private manualTask: Promise<void> | undefined
  private disposed = false

  constructor(private readonly options: DesktopUpdateLifecycleOptions) {
    this.snapshot = {
      schemaVersion: 1, distributionId: DESKTOP_DISTRIBUTION_ID,
      currentVersion: options.adapter.currentVersion,
      channel: (parseSemVer(options.adapter.currentVersion)?.prerelease.length ?? 0) > 0 ? 'prerelease' : 'stable',
      downloadPageUrl: DESKTOP_DOWNLOAD_PAGE, state: 'unchecked', updateAvailable: false, usedCache: false,
    }
    this.registration = options.registerTrayItem({
      group: 'tools', order: 10,
      label: () => this.snapshot.state === 'checking'
        ? desktopTrayLabel(options.locale(), 'checkingForUpdates')
        : this.snapshot.updateAvailable
          ? desktopTrayLabel(options.locale(), 'updateAvailable', this.snapshot.latestVersion!)
          : desktopTrayLabel(options.locale(), 'checkForUpdates'),
      invoke: () => this.manualCheck(),
    })
    this.stateReady = this.loadPromptHistory()
    if (options.adapter.isPackaged && options.policy.enabled) this.schedule(options.policy.initialDelayMs)
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
    for (const listener of this.listeners) {
      try { listener() } catch { /* A subscriber cannot interrupt distribution discovery. */ }
    }
  }
  check(): Promise<DesktopDistributionSnapshot> {
    if (this.disposed) return Promise.resolve(this.snapshot)
    if (this.task !== undefined) return this.task
    this.publish({ ...this.snapshot, state: 'checking' })
    const controller = new AbortController()
    this.controller = controller
    const timeout = new Promise<null>(resolve => {
      controller.signal.addEventListener('abort', () => { resolve(null) }, { once: true })
      this.requestTimer = setTimeout(() => { controller.abort() }, this.options.policy.requestTimeoutMs)
    })
    this.task = (async () => {
      const result = await Promise.race([
        checkForDesktopUpdate({ currentVersion: this.snapshot.currentVersion, request: this.options.adapter.request, signal: controller.signal }).catch(() => null),
        timeout,
      ])
      this.publish(result === null
        ? { ...this.snapshot, state: 'failed', usedCache: this.snapshot.checkedAt !== undefined }
        : { schemaVersion: 1, distributionId: DESKTOP_DISTRIBUTION_ID,
          currentVersion: this.snapshot.currentVersion, channel: this.snapshot.channel,
          downloadPageUrl: DESKTOP_DOWNLOAD_PAGE, state: 'ready', usedCache: false,
          latestVersion: result.latestVersion, updateAvailable: result.status === 'update-available',
          noRelease: result.status === 'no-release', checkedAt: new Date().toISOString(),
          ...result.bundledVersions === undefined ? {} : { bundledVersions: result.bundledVersions } })
      return this.snapshot
    })().finally(() => {
      if (this.requestTimer !== undefined) clearTimeout(this.requestTimer)
      this.requestTimer = undefined
      this.controller = undefined
      this.task = undefined
    })
    return this.task
  }
  private manualCheck(): Promise<void> {
    this.manualTask ??= (async () => {
      const snapshot = await this.check()
      if (this.disposed) return
      const result: UpdateCheckResult | null = snapshot.state === 'failed' ? null : {
        status: snapshot.noRelease ? 'no-release' : snapshot.updateAvailable ? 'update-available' : 'up-to-date',
        currentVersion: snapshot.currentVersion, latestVersion: snapshot.latestVersion ?? snapshot.currentVersion,
      }
      await this.options.adapter.showManualCheckResult(result)
    })().catch(() => {}).finally(() => { this.manualTask = undefined })
    return this.manualTask
  }
  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      void this.backgroundCheck().catch(() => {}).finally(() => {
        if (!this.disposed) this.schedule(this.options.policy.intervalMs)
      })
    }, delay)
  }
  private async backgroundCheck(): Promise<void> {
    const snapshot = await this.check()
    await this.stateReady
    if (this.disposed || snapshot.state !== 'ready' || !snapshot.updateAvailable
      || this.lastPromptedVersion === snapshot.latestVersion) return
    this.lastPromptedVersion = snapshot.latestVersion
    try {
      await writeFileAtomic(this.options.adapter.statePath, JSON.stringify({ version: 3,
        distributionId: DESKTOP_DISTRIBUTION_ID, channel: this.snapshot.channel,
        lastPromptedVersion: this.lastPromptedVersion }) + '\n', { mode: 0o600, dirMode: 0o700 })
    } catch { /* Prompt history is optional; version checks remain available. */ }
    if (this.disposed) return
    const zh = this.options.locale() === 'zh'
    this.options.adapter.notify({ title: zh ? 'DSH Desktop 有新版本' : 'DSH Desktop update available',
      body: zh ? '可在设置或托盘中查看版本并前往下载页面。' : 'Check Settings or the tray to visit the download page.' })
  }
  private async loadPromptHistory(): Promise<void> {
    try {
      const file = await open(this.options.adapter.statePath, 'r')
      let content: string
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > 4096) return
        const bytes = Buffer.alloc(4097)
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
        if (bytesRead > 4096) return
        content = bytes.subarray(0, bytesRead).toString('utf8')
      } finally { await file.close() }
      const state = JSON.parse(content) as Record<string, unknown>
      if (state.version === 3 && state.distributionId === DESKTOP_DISTRIBUTION_ID
        && state.channel === this.snapshot.channel && typeof state.lastPromptedVersion === 'string'
        && parseSemVer(state.lastPromptedVersion) !== null) this.lastPromptedVersion = state.lastPromptedVersion
    } catch { /* No history is a normal first launch. */ }
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.controller?.abort()
    if (this.requestTimer !== undefined) clearTimeout(this.requestTimer)
    this.listeners.clear()
    this.registration.dispose()
    await Promise.allSettled([this.stateReady, this.task])
  }
}
