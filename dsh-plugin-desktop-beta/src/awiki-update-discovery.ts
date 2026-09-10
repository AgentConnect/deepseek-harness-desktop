/** Discover one trusted, compatible stable AWiki plugin pair from npm. */

import { compare, prerelease, rcompare, satisfies, valid } from 'semver'
import {
  AWIKI_MODEL_PROXY_PACKAGE,
  AWIKI_PLUGIN_PACKAGE,
} from './awiki-package-compatibility.ts'
import {
  readDesktopAwikiProfileVersions,
  type DesktopAwikiProfileVersions,
} from './awiki-profile-upgrade.ts'

const NPM_REGISTRY_ORIGIN = 'https://registry.npmjs.org'
const EXPECTED_REPOSITORY = 'github.com/AgentConnect/dsh-awiki'
const MAX_PACKUMENT_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000
const INSTALL_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const

type UnknownRecord = Record<string, unknown>

interface TrustedVersion {
  readonly version: string
  readonly pluginRange?: string
}

interface TrustedPackument {
  readonly packageName: string
  readonly versions: readonly TrustedVersion[]
}

export interface DesktopAwikiUpdateRequest {
  (url: string, init: { readonly headers: Readonly<Record<string, string>>; readonly signal: AbortSignal }): Promise<Response>
}

export interface DesktopAwikiUpdateDiscoveryOptions {
  readonly profileDir: string
  readonly request: DesktopAwikiUpdateRequest
  readonly timeoutMs?: number
}

export type DesktopAwikiUpdateDiscovery =
  | {
      readonly status: 'up-to-date'
      readonly current: Partial<DesktopAwikiProfileVersions>
      readonly target: DesktopAwikiProfileVersions
    }
  | {
      readonly status: 'available'
      readonly current: Partial<DesktopAwikiProfileVersions>
      readonly target: DesktopAwikiProfileVersions
    }

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function own(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function stableVersion(value: unknown): value is string {
  return typeof value === 'string'
    && valid(value, { loose: false }) === value
    && prerelease(value, { loose: false }) === null
}

function sha512Integrity(value: unknown): boolean {
  if (typeof value !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(value)) return false
  const encoded = value.slice('sha512-'.length)
  const digest = Buffer.from(encoded, 'base64')
  return digest.byteLength === 64 && digest.toString('base64') === encoded
}

function officialTarball(value: unknown, packageName: string, version: string): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.origin === NPM_REGISTRY_ORIGIN
      && url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.hash === ''
      && url.pathname.endsWith(`/-/${packageName.slice(packageName.indexOf('/') + 1)}-${version}.tgz`)
  } catch {
    return false
  }
}

function trustedRepository(value: unknown): boolean {
  const raw = typeof value === 'string' ? value : record(value)?.url
  if (typeof raw !== 'string') return false
  const normalized = raw
    .replace(/^git\+/u, '')
    .replace(/^git:\/\//u, 'https://')
    .replace(/^git@github\.com:/u, 'https://github.com/')
    .replace(/\.git(?:#.*)?$/u, '')
    .replace(/^https?:\/\//u, '')
    .replace(/\/$/u, '')
  return normalized === EXPECTED_REPOSITORY
}

function trustedManifest(
  packageName: string,
  version: string,
  value: unknown,
): TrustedVersion | undefined {
  const manifest = record(value)
  if (manifest === undefined || manifest.name !== packageName || manifest.version !== version) return undefined
  if (own(manifest, 'deprecated') || !trustedRepository(manifest.repository)) return undefined
  const scripts = record(manifest.scripts)
  if (scripts !== undefined && INSTALL_LIFECYCLE_SCRIPTS.some(script => own(scripts, script))) return undefined
  const dist = record(manifest.dist)
  if (dist === undefined
    || !sha512Integrity(dist.integrity)
    || !officialTarball(dist.tarball, packageName, version)) return undefined

  if (packageName !== AWIKI_MODEL_PROXY_PACKAGE) return { version }
  const pluginRange = record(manifest.peerDependencies)?.[AWIKI_PLUGIN_PACKAGE]
  if (typeof pluginRange !== 'string' || pluginRange.length === 0 || pluginRange.length > 256) return undefined
  return { version, pluginRange }
}

async function readBoundedJson(response: Response, requestUrl: string): Promise<unknown> {
  let responseOrigin: string
  try {
    responseOrigin = new URL(response.url || requestUrl).origin
  } catch {
    throw new Error('dsh-plugin-desktop: npm registry request failed')
  }
  if (!response.ok || responseOrigin !== NPM_REGISTRY_ORIGIN) {
    throw new Error('dsh-plugin-desktop: npm registry request failed')
  }
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_PACKUMENT_BYTES) {
    throw new Error('dsh-plugin-desktop: npm registry response is too large')
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_PACKUMENT_BYTES) {
    throw new Error('dsh-plugin-desktop: npm registry response is too large')
  }
  return JSON.parse(buffer.toString('utf8')) as unknown
}

async function fetchPackument(
  packageName: string,
  request: DesktopAwikiUpdateRequest,
  signal: AbortSignal,
): Promise<TrustedPackument> {
  const requestUrl = `${NPM_REGISTRY_ORIGIN}/${encodeURIComponent(packageName)}`
  const response = await request(requestUrl, {
    headers: { Accept: 'application/json' },
    signal,
  })
  const packument = record(await readBoundedJson(response, requestUrl))
  const versions = record(packument?.versions)
  const times = record(packument?.time)
  if (packument?.name !== packageName || versions === undefined || times === undefined) {
    throw new Error('dsh-plugin-desktop: npm registry response was invalid')
  }
  const trusted: TrustedVersion[] = []
  for (const [version, manifest] of Object.entries(versions)) {
    if (!stableVersion(version)) continue
    const published = times[version]
    if (typeof published !== 'string' || !Number.isFinite(Date.parse(published))) continue
    const candidate = trustedManifest(packageName, version, manifest)
    if (candidate !== undefined) trusted.push(candidate)
  }
  trusted.sort((left, right) => rcompare(left.version, right.version))
  if (trusted.length === 0) throw new Error('dsh-plugin-desktop: npm registry has no trusted stable AWiki release')
  return { packageName, versions: Object.freeze(trusted) }
}

function compatiblePairs(
  plugins: TrustedPackument,
  proxies: TrustedPackument,
): readonly DesktopAwikiProfileVersions[] {
  const pairs: DesktopAwikiProfileVersions[] = []
  for (const plugin of plugins.versions) {
    for (const proxy of proxies.versions) {
      try {
        if (proxy.pluginRange === undefined || !satisfies(plugin.version, proxy.pluginRange)) continue
      } catch {
        continue
      }
      pairs.push({ pluginVersion: plugin.version, modelProxyVersion: proxy.version })
      break
    }
  }
  return pairs
}

function samePair(
  current: Partial<DesktopAwikiProfileVersions>,
  target: DesktopAwikiProfileVersions,
): boolean {
  return current.pluginVersion === target.pluginVersion
    && current.modelProxyVersion === target.modelProxyVersion
}

function newerPair(
  current: Partial<DesktopAwikiProfileVersions>,
  target: DesktopAwikiProfileVersions,
): boolean {
  if (!stableVersion(current.pluginVersion) || !stableVersion(current.modelProxyVersion)) return true
  const plugin = compare(target.pluginVersion, current.pluginVersion)
  const proxy = compare(target.modelProxyVersion, current.modelProxyVersion)
  return plugin >= 0 && proxy >= 0 && (plugin > 0 || proxy > 0)
}

/** Resolve the newest trusted compatible pair. */
export async function discoverDesktopAwikiUpdate(
  options: DesktopAwikiUpdateDiscoveryOptions,
): Promise<DesktopAwikiUpdateDiscovery> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('dsh-plugin-desktop: AWiki update policy is invalid')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  timer.unref()
  try {
    const [current, pluginPackument, proxyPackument] = await Promise.all([
      readDesktopAwikiProfileVersions(options.profileDir),
      fetchPackument(AWIKI_PLUGIN_PACKAGE, options.request, controller.signal),
      fetchPackument(AWIKI_MODEL_PROXY_PACKAGE, options.request, controller.signal),
    ])
    const pairs = compatiblePairs(pluginPackument, proxyPackument)
    const newest = pairs[0]
    if (newest === undefined) throw new Error('dsh-plugin-desktop: npm registry has no compatible stable AWiki pair')
    if (samePair(current, newest) || !newerPair(current, newest)) {
      return { status: 'up-to-date', current, target: newest }
    }
    return { status: 'available', current, target: newest }
  } finally {
    clearTimeout(timer)
  }
}

export const awikiUpdateDiscoveryConstants = Object.freeze({
  npmRegistryOrigin: NPM_REGISTRY_ORIGIN,
  maxPackumentBytes: MAX_PACKUMENT_BYTES,
})
