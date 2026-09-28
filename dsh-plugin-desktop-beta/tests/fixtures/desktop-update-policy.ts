/** Synthetic tenant-owned policies; no network or production artifacts. */
export const china = { tenantId: 'china', policyOrigin: 'https://china.example', tenantGeneration: 0 }
export const globalTenant = { tenantId: 'global', policyOrigin: 'https://global.example', tenantGeneration: 1 }
export function desktopRelease(origin: string, version: string) {
  return { distribution_id: 'awiki-dsh-desktop', channel: version.includes('-') ? 'prerelease' : 'stable', version,
    download_page_url: `${origin}/downloads/dsh-awiki/`, source_commit: 'a'.repeat(40), published_at: '2026-09-14T00:00:00Z',
    bundled_versions: { plugin: '0.3.11-rc.1', model_proxy: '0.1.7-rc.1' },
    artifacts: [['macos-universal', 'dmg', '.dmg'], ['windows-x64', 'installer', '.exe'], ['windows-x64', 'portable', '.zip']].map(([platform, kind, extension]) => ({
      platform, kind, filename: `Desktop-${version}-${kind}${extension}`, url: `https://shared.example/${version}/${kind}${extension}`,
      sha256: 'a'.repeat(64), size_bytes: 123, signing_state: 'unsigned',
    })) }
}
export function desktopPolicy(origin = china.policyOrigin, versions = ['2.1.0'], revision = 1) {
  const channels: Record<string, ReturnType<typeof desktopRelease>> = {}
  for (const version of versions) {
    const release = desktopRelease(origin, version)
    channels[release.channel] = release
  }
  return { schema_version: 1, client_versions: { schema_version: 1, channel: 'stable', policy_origin: origin,
    policy_revision: revision, published_at: '2026-09-14T00:00:00Z',
    products: { dsh: { enabled: false, desktop: { enabled: true, channels } } } } }
}
