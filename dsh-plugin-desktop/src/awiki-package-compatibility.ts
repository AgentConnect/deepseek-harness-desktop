/** Compatibility-aware source selection for the Desktop-owned AWiki bundle pair. */

import { readFileSync } from 'node:fs'
import { satisfies } from 'semver'
import {
  findOverlayPackage,
  type PackageOverlayCandidate,
  type PackageOverlayOptions,
  type PackageOverlaySource,
} from './package-overlay.ts'

export const AWIKI_PLUGIN_PACKAGE = '@awiki/dsh-plugin'
export const AWIKI_MODEL_PROXY_PACKAGE = '@awiki/dsh-model-proxy'

export interface DesktopAwikiCompatibilityFallback {
  readonly source: PackageOverlaySource
  readonly pluginVersion: string
  readonly modelProxyVersion: string
  readonly rejectedPluginVersion: string
  readonly rejectedModelProxyVersion: string
}

export interface DesktopAwikiCompatibilitySelection {
  readonly preferredSources: ReadonlyMap<string, PackageOverlaySource>
  readonly fallback?: DesktopAwikiCompatibilityFallback
}

export interface DesktopAwikiCompatibilityIssue {
  readonly pluginVersion: string
  readonly modelProxyVersion: string
  readonly requiredPluginRange: string
}

export class DesktopAwikiCompatibilityError extends Error {
  constructor(readonly issue: DesktopAwikiCompatibilityIssue) {
    super(`AWiki Model Proxy ${issue.modelProxyVersion} requires ${AWIKI_PLUGIN_PACKAGE} ${issue.requiredPluginRange}, but Desktop selected ${issue.pluginVersion}.`)
    this.name = 'DesktopAwikiCompatibilityError'
  }
}

interface PackageManifest {
  readonly peerDependencies?: Readonly<Record<string, unknown>>
}

function pluginRange(proxy: PackageOverlayCandidate): string | undefined {
  let manifest: PackageManifest
  try {
    manifest = JSON.parse(readFileSync(proxy.manifestPath, 'utf8')) as PackageManifest
  } catch {
    return undefined
  }
  const range = manifest.peerDependencies?.[AWIKI_PLUGIN_PACKAGE]
  return typeof range === 'string' && range.length > 0 && range.length <= 256 ? range : undefined
}

function compatible(
  plugin: PackageOverlayCandidate | undefined,
  proxy: PackageOverlayCandidate | undefined,
): { readonly compatible: boolean; readonly range?: string } {
  if (plugin?.version === undefined || proxy?.version === undefined) return { compatible: false }
  const range = pluginRange(proxy)
  if (range === undefined) return { compatible: false }
  try {
    return { compatible: satisfies(plugin.version, range), range }
  } catch {
    return { compatible: false, range }
  }
}

/**
 * Keep the independently versioned AWiki packages on a compatible pair.
 * The ordinary newest-wins overlay remains unchanged when its pair is valid.
 */
export function selectDesktopAwikiCompatibility(
  options: Omit<PackageOverlayOptions, 'preferredSources'>,
): DesktopAwikiCompatibilitySelection {
  const plugin = findOverlayPackage(AWIKI_PLUGIN_PACKAGE, options)
  const proxy = findOverlayPackage(AWIKI_MODEL_PROXY_PACKAGE, options)
  if (plugin === undefined || proxy === undefined) {
    const missing = plugin === undefined ? AWIKI_PLUGIN_PACKAGE : AWIKI_MODEL_PROXY_PACKAGE
    throw new Error(`dsh-plugin-desktop: required AWiki package ${missing} is unavailable`)
  }
  const selected = compatible(plugin.selected, proxy.selected)
  if (selected.compatible) {
    return {
      preferredSources: new Map([
        [AWIKI_PLUGIN_PACKAGE, plugin.selected.source],
        [AWIKI_MODEL_PROXY_PACKAGE, proxy.selected.source],
      ]),
    }
  }

  for (const source of ['profile', 'install'] as const) {
    const sourcePlugin = source === 'profile' ? plugin.profile : plugin.install
    const sourceProxy = source === 'profile' ? proxy.profile : proxy.install
    if (!compatible(sourcePlugin, sourceProxy).compatible) continue
    return {
      preferredSources: new Map([
        [AWIKI_PLUGIN_PACKAGE, source],
        [AWIKI_MODEL_PROXY_PACKAGE, source],
      ]),
      fallback: {
        source,
        pluginVersion: sourcePlugin!.version!,
        modelProxyVersion: sourceProxy!.version!,
        rejectedPluginVersion: plugin.selected.version ?? 'unknown',
        rejectedModelProxyVersion: proxy.selected.version ?? 'unknown',
      },
    }
  }

  throw new DesktopAwikiCompatibilityError({
    pluginVersion: plugin.selected.version ?? 'unknown',
    modelProxyVersion: proxy.selected.version ?? 'unknown',
    requiredPluginRange: selected.range ?? 'a compatible version',
  })
}
