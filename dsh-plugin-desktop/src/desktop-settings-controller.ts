/** Launcher-backed controller for the private Desktop settings API. */

import { randomBytes } from 'node:crypto'
import type {
  DesktopMarketProvider,
  DesktopMarketSnapshot,
} from './desktop-market.ts'
import type { DesktopProfileSummary } from './profile-manager.ts'
import type { DesktopProfiles } from './profile-service.ts'
import type {
  DesktopAwikiUpdateApplyResponse,
  DesktopAwikiUpdateCheckResponse,
  DesktopAwikiVersionsView,
  DesktopMarketSelectResponse,
  DesktopDiagnosticsExportResponse,
  DesktopProfileCreateResponse,
  DesktopProfileCreateWindowResponse,
  DesktopProfileDeleteResponse,
  DesktopProfileRollbackResponse,
  DesktopProfileSelectResponse,
  DesktopSettingsMarketView,
  DesktopSettingsProfileView,
  DesktopSettingsResponse,
  DesktopTerminalOpenResponse,
} from './desktop-settings-contract.ts'
import type {
  DesktopAwikiUpdateDiscovery,
  DesktopAwikiUpdatePolicySelection,
} from './awiki-update-discovery.ts'
import type { DesktopAwikiProfileVersions } from './awiki-profile-upgrade.ts'

const AWIKI_UPDATE_PREVIEW_TTL_MS = 5 * 60 * 1000
const MAX_AWIKI_UPDATE_PREVIEWS = 4

interface DesktopAwikiUpdatePreview {
  readonly current: DesktopAwikiVersionsView
  readonly target: DesktopAwikiProfileVersions
  readonly policy: DesktopAwikiUpdatePolicySelection
  readonly expiresAt: number
}

/** Launcher capabilities used without exposing their filesystem roots. */
export interface DesktopSettingsControllerBootstrap {
  /** Generation-scoped profile service. */
  readonly profiles: Pick<DesktopProfiles, 'current' | 'list' | 'create'>
    & Partial<Pick<DesktopProfiles, 'canDelete' | 'delete'>>
  /** Persist one already-validated profile as pending without restarting. */
  persistProfileSelection(name: string): void | Promise<void>
  /** Read the latest persisted request and the startup-effective provider. */
  readMarket(): DesktopMarketSnapshot
  /** Persist an explicit provider request. */
  selectMarket(provider: DesktopMarketProvider): Promise<DesktopMarketSnapshot>
  /** Queue an orderly restart after a response confirms persisted selection. */
  scheduleRestart(): void
  /** Open the launcher-owned DSH terminal. */
  openTerminal(): void
  /** Export diagnostics through the launcher-owned privacy flow. */
  exportDiagnostics(): void | Promise<void>
  /** Open the isolated native Profile creator. */
  openProfileCreator(): void
  /** Prepare a last-known-good rollback without quiescing the Host yet. */
  prepareProfileRollback(): DesktopSettingsPostResponse<DesktopProfileRollbackResponse>
  /** Discover one trusted stable AWiki pair without mutating the Profile. */
  checkAwikiUpdate(): Promise<DesktopAwikiUpdateDiscovery>
  /** Prepare one exact update after the Renderer confirms its opaque preview. */
  prepareAwikiUpgrade(
    current: DesktopAwikiVersionsView,
    target: DesktopAwikiProfileVersions,
    policy: DesktopAwikiUpdatePolicySelection,
  ): DesktopSettingsPostResponse<DesktopAwikiUpdateApplyResponse>
  /** Injectable clock for preview expiry tests. */
  readonly now?: () => number
}

/** A persisted response plus work that must run only after `res.end()`. */
export interface DesktopSettingsPostResponse<T extends object> {
  readonly response: T
  readonly afterResponse?: () => void
}

/** Remove paths, bundle identities, and parser diagnostics from a profile. */
export function projectDesktopSettingsProfile(
  profile: DesktopProfileSummary,
  deletable = false,
): DesktopSettingsProfileView {
  return Object.freeze({
    name: profile.name,
    exists: profile.exists,
    webCapable: profile.webCapable,
    selectable: profile.webCapable && profile.problem === undefined,
    deletable,
  })
}

function projectMarket(
  value: DesktopMarketSnapshot,
  effective: DesktopMarketProvider,
): DesktopSettingsMarketView {
  return Object.freeze({
    requested: value.requested,
    effective,
    legacyDefaulted: value.legacyDefaulted,
  })
}

/**
 * Generation-scoped controller for Profile and Market preferences.
 *
 * The provider composed at startup remains `effective` for this controller's
 * lifetime. Persisting another provider changes only `requested` until the
 * queued restart creates a new Host generation.
 */
export class DesktopSettingsController {
  private readonly effectiveMarket: DesktopMarketProvider
  private readonly awikiUpdatePreviews = new Map<string, DesktopAwikiUpdatePreview>()

  constructor(private readonly bootstrap: DesktopSettingsControllerBootstrap) {
    this.effectiveMarket = bootstrap.readMarket().effective
  }

  /** Read a fresh, renderer-safe settings projection. */
  read(): DesktopSettingsResponse {
    return Object.freeze({
      current: this.bootstrap.profiles.current.name,
      profiles: Object.freeze(
        this.bootstrap.profiles.list().map(profile => projectDesktopSettingsProfile(
          profile,
          this.bootstrap.profiles.canDelete?.(profile.name) ?? false,
        )),
      ),
      market: projectMarket(this.bootstrap.readMarket(), this.effectiveMarket),
    })
  }

  /** Create one safe profile without selecting it or requesting restart. */
  createProfile(name: string): DesktopProfileCreateResponse {
    this.bootstrap.profiles.create(name)
    return this.read()
  }

  /** Delete one inactive user profile and return the fresh settings state. */
  async deleteProfile(name: string): Promise<DesktopProfileDeleteResponse> {
    if (this.bootstrap.profiles.delete === undefined) {
      throw new Error('dsh-plugin-desktop: profile deletion is unavailable')
    }
    await this.bootstrap.profiles.delete(name)
    return this.read()
  }

  /** Persist a fresh compatible profile, deferring restart until after response. */
  async selectProfile(
    name: string,
  ): Promise<DesktopSettingsPostResponse<DesktopProfileSelectResponse>> {
    const restartRequired = name !== this.bootstrap.profiles.current.name
    if (restartRequired) {
      const profile = this.bootstrap.profiles.list().find(candidate => candidate.name === name)
      if (profile === undefined || !profile.webCapable || profile.problem !== undefined) {
        throw new Error(`dsh-plugin-desktop: profile ${JSON.stringify(name)} is not selectable`)
      }
      await this.bootstrap.persistProfileSelection(name)
    }
    return Object.freeze({
      response: Object.freeze({ accepted: true, restartRequired }),
      ...(restartRequired ? { afterResponse: () => { this.bootstrap.scheduleRestart() } } : {}),
    })
  }

  /** Persist a provider and defer restart until after the response is ended. */
  async selectMarket(
    provider: DesktopMarketProvider,
  ): Promise<DesktopSettingsPostResponse<DesktopMarketSelectResponse>> {
    await this.bootstrap.selectMarket(provider)
    const restartRequired = provider !== this.effectiveMarket
    return Object.freeze({
      response: Object.freeze({ accepted: true, restartRequired }),
      ...(restartRequired ? { afterResponse: () => { this.bootstrap.scheduleRestart() } } : {}),
    })
  }

  /** Open the native terminal through the launcher-owned action. */
  openTerminal(): DesktopTerminalOpenResponse {
    this.bootstrap.openTerminal()
    return Object.freeze({ accepted: true })
  }

  /** Export diagnostics through the native confirmation and reveal flow. */
  async exportDiagnostics(): Promise<DesktopDiagnosticsExportResponse> {
    await this.bootstrap.exportDiagnostics()
    return Object.freeze({ accepted: true })
  }

  /** Open the native creator that creates, selects, and restarts safely. */
  openProfileCreator(): DesktopProfileCreateWindowResponse {
    this.bootstrap.openProfileCreator()
    return Object.freeze({ accepted: true })
  }

  /** Hand off a validated rollback that starts only after the HTTP response. */
  rollbackProfile(): DesktopSettingsPostResponse<DesktopProfileRollbackResponse> {
    return this.bootstrap.prepareProfileRollback()
  }

  /** Check the fixed npm packages and mint authority only for an eligible update. */
  async checkAwikiUpdate(): Promise<DesktopAwikiUpdateCheckResponse> {
    const result = await this.bootstrap.checkAwikiUpdate()
    if (result.status !== 'available') return Object.freeze(result)
    const now = (this.bootstrap.now ?? Date.now)()
    this.pruneAwikiUpdatePreviews(now)
    while (this.awikiUpdatePreviews.size >= MAX_AWIKI_UPDATE_PREVIEWS) {
      const oldest = this.awikiUpdatePreviews.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.awikiUpdatePreviews.delete(oldest)
    }
    const previewId = randomBytes(32).toString('base64url')
    this.awikiUpdatePreviews.set(previewId, {
      current: result.current,
      target: result.target,
      policy: result.policy,
      expiresAt: now + AWIKI_UPDATE_PREVIEW_TTL_MS,
    })
    return Object.freeze({ ...result, previewId })
  }

  /** Consume one short-lived exact preview and defer mutation until after HTTP response. */
  applyAwikiUpdate(
    previewId: string,
  ): DesktopSettingsPostResponse<DesktopAwikiUpdateApplyResponse> {
    const now = (this.bootstrap.now ?? Date.now)()
    this.pruneAwikiUpdatePreviews(now)
    const preview = this.awikiUpdatePreviews.get(previewId)
    if (preview === undefined) {
      throw new Error('dsh-plugin-desktop: AWiki update preview expired or was already used')
    }
    this.awikiUpdatePreviews.delete(previewId)
    return this.bootstrap.prepareAwikiUpgrade(preview.current, preview.target, preview.policy)
  }

  private pruneAwikiUpdatePreviews(now: number): void {
    for (const [previewId, preview] of this.awikiUpdatePreviews) {
      if (preview.expiresAt <= now) this.awikiUpdatePreviews.delete(previewId)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Launcher-owned controller behind the private loopback settings API. */
    desktopSettingsController: DesktopSettingsController
  }
}

export default DesktopSettingsController
