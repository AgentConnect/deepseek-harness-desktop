/** Quiescence and compare-and-swap boundary for a settings-triggered AWiki update. */

import type {
  DesktopAwikiProfileUpgradeResult,
  DesktopAwikiProfileVersions,
} from './awiki-profile-upgrade.ts'

export interface DesktopAwikiUpdateExecutionOptions {
  readonly expectedCurrent: Partial<DesktopAwikiProfileVersions>
  quiesceHost(): Promise<boolean>
  readCurrent(): Promise<Partial<DesktopAwikiProfileVersions>>
  upgrade(): Promise<DesktopAwikiProfileUpgradeResult>
}

function sameVersions(
  left: Partial<DesktopAwikiProfileVersions>,
  right: Partial<DesktopAwikiProfileVersions>,
): boolean {
  return left.pluginVersion === right.pluginVersion
    && left.modelProxyVersion === right.modelProxyVersion
}

/** Stop the Host and reject stale update previews before any Profile mutation. */
export async function executeDesktopAwikiUpdate(
  options: DesktopAwikiUpdateExecutionOptions,
): Promise<DesktopAwikiProfileUpgradeResult> {
  if (!await options.quiesceHost()) {
    throw new Error('dsh-plugin-desktop: Host could not be stopped safely for AWiki update')
  }
  const current = await options.readCurrent()
  if (!sameVersions(current, options.expectedCurrent)) {
    throw new Error('dsh-plugin-desktop: AWiki Profile versions changed after the update check')
  }
  return await options.upgrade()
}
