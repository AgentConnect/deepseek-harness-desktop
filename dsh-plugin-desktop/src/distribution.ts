/** Public, optional Host contract for this Desktop distribution's update information. */
export const DESKTOP_DISTRIBUTION_ID = 'awiki-dsh-desktop'
export interface DesktopTenantContext {
  readonly tenantId: string
  readonly policyOrigin: string
  readonly tenantGeneration: number
}

export interface DesktopDistributionSnapshot {
  readonly schemaVersion: 2
  readonly distributionId: typeof DESKTOP_DISTRIBUTION_ID
  readonly currentVersion: string
  readonly channel: 'stable' | 'prerelease'
  readonly tenantId?: string
  readonly policyOrigin?: string
  readonly tenantGeneration?: number
  readonly policyRevision?: number
  readonly downloadPageUrl?: string
  readonly state: 'unchecked' | 'checking' | 'ready' | 'failed' | 'unavailable'
  readonly latestVersion?: string
  readonly updateAvailable: boolean
  readonly noRelease?: boolean
  readonly usedCache: boolean
  readonly checkedAt?: string
  readonly bundledVersions?: Readonly<{ plugin: string; modelProxy?: string }>
}

/** Public tenant/version metadata only; no native objects, secrets or installer operations. */
export interface DesktopDistribution {
  setTenant(tenant: DesktopTenantContext | undefined): void
  getSnapshot(): DesktopDistributionSnapshot
  check(): Promise<DesktopDistributionSnapshot>
  subscribe(listener: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopDistribution: DesktopDistribution
  }
}
