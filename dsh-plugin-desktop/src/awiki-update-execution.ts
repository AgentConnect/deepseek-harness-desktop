/** Quiescence and compare-and-swap boundary for a settings-triggered AWiki update. */

import type {
  DesktopAwikiProfileUpgradeResult,
  DesktopAwikiProfileVersions,
} from './awiki-profile-upgrade.ts'
import type { DesktopAwikiUpdatePolicySelection } from './awiki-update-discovery.ts'

export interface DesktopAwikiUpdateExecutionOptions {
  readonly expectedCurrent: Partial<DesktopAwikiProfileVersions>
  readonly expectedPolicy: DesktopAwikiUpdatePolicySelection
  readPolicy(): DesktopAwikiUpdatePolicySelection
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

function samePolicy(
  left: DesktopAwikiUpdatePolicySelection,
  right: DesktopAwikiUpdatePolicySelection,
): boolean {
  return left.tenantId === right.tenantId
    && left.tenantGeneration === right.tenantGeneration
    && left.policyRevision === right.policyRevision
    && left.plugin.version === right.plugin.version
    && left.plugin.integrity === right.plugin.integrity
    && left.modelProxy.version === right.modelProxy.version
    && left.modelProxy.integrity === right.modelProxy.integrity
}

/** Stop the Host and reject stale update previews before any Profile mutation. */
export async function executeDesktopAwikiUpdate(
  options: DesktopAwikiUpdateExecutionOptions,
): Promise<DesktopAwikiProfileUpgradeResult> {
  if (!samePolicy(options.readPolicy(), options.expectedPolicy)) {
    throw new Error('dsh-plugin-desktop: active tenant update policy changed after the update check')
  }
  if (!await options.quiesceHost()) {
    throw new Error('dsh-plugin-desktop: Host could not be stopped safely for AWiki update')
  }
  const current = await options.readCurrent()
  if (!sameVersions(current, options.expectedCurrent)) {
    throw new Error('dsh-plugin-desktop: AWiki Profile versions changed after the update check')
  }
  return await options.upgrade()
}
