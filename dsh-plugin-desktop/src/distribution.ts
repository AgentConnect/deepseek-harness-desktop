/** Public, optional Host contract for this Desktop distribution's update information. */
export const DESKTOP_DISTRIBUTION_ID = 'awiki-dsh-desktop'
export const DESKTOP_DOWNLOAD_PAGE = 'https://awiki.me/downloads/dsh-awiki/'

export interface DesktopDistributionSnapshot {
  readonly schemaVersion: 1
  readonly distributionId: typeof DESKTOP_DISTRIBUTION_ID
  readonly currentVersion: string
  readonly channel: 'stable' | 'prerelease'
  readonly downloadPageUrl: string
  readonly state: 'unchecked' | 'checking' | 'ready' | 'failed'
  readonly latestVersion?: string
  readonly updateAvailable: boolean
  readonly noRelease?: boolean
  readonly usedCache: boolean
  readonly checkedAt?: string
  readonly bundledVersions?: Readonly<{ plugin: string; modelProxy?: string }>
}

/** No native objects, arbitrary URLs, installer operations or tenant state cross this boundary. */
export interface DesktopDistribution {
  getSnapshot(): DesktopDistributionSnapshot
  check(): Promise<DesktopDistributionSnapshot>
  subscribe(listener: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopDistribution: DesktopDistribution
  }
}
