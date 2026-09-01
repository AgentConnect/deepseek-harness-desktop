import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  awikiUpdateDiscoveryConstants,
  discoverDesktopAwikiUpdate,
  type DesktopAwikiUpdateRequest,
} from '../src/awiki-update-discovery.ts'

const INTEGRITY = `sha512-${Buffer.alloc(64).toString('base64')}`
const REPOSITORY = 'git+https://github.com/AgentConnect/dsh-awiki.git'
const roots: string[] = []

function policy(pluginVersion: string, modelProxyVersion: string) {
  return {
    tenantId: 'official-china',
    tenantGeneration: 7,
    policyRevision: 12,
    plugin: { version: pluginVersion, integrity: INTEGRITY },
    modelProxy: { version: modelProxyVersion, integrity: INTEGRITY },
  }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function profile(pluginVersion = '0.3.2', modelProxyVersion = '0.1.2'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-awiki-update-'))
  roots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify({
    private: true,
    dependencies: {
      '@awiki/dsh-plugin': pluginVersion,
      '@awiki/dsh-model-proxy': modelProxyVersion,
    },
  }))
  return root
}

function manifest(packageName: string, version: string, pluginRange?: string): Record<string, unknown> {
  const leaf = packageName.slice(packageName.indexOf('/') + 1)
  return {
    name: packageName,
    version,
    repository: REPOSITORY,
    ...(pluginRange === undefined ? {} : { peerDependencies: { '@awiki/dsh-plugin': pluginRange } }),
    dist: {
      integrity: INTEGRITY,
      tarball: `https://registry.npmjs.org/${packageName}/-/${leaf}-${version}.tgz`,
    },
  }
}

function packument(
  packageName: string,
  releases: readonly { readonly version: string; readonly publishedAt: string; readonly pluginRange?: string; readonly scripts?: object }[],
): Record<string, unknown> {
  return {
    name: packageName,
    versions: Object.fromEntries(releases.map(release => [
      release.version,
      { ...manifest(packageName, release.version, release.pluginRange), ...(release.scripts === undefined ? {} : { scripts: release.scripts }) },
    ])),
    time: Object.fromEntries(releases.map(release => [release.version, release.publishedAt])),
  }
}

function registry(
  plugin: Record<string, unknown>,
  proxy: Record<string, unknown>,
  responseUrl: (requestUrl: string) => string = requestUrl => requestUrl,
): DesktopAwikiUpdateRequest {
  return vi.fn(async (url: string) => {
    const value = url.includes('dsh-plugin') ? plugin : proxy
    const response = new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    Object.defineProperty(response, 'url', { configurable: true, value: responseUrl(url) })
    return response
  })
}

describe('AWiki update discovery', () => {
  it('selects only the active tenant policy pair from trusted npm metadata', async () => {
    const profileDir = await profile()
    const request = registry(
      packument('@awiki/dsh-plugin', [
        { version: '0.3.3', publishedAt: '2026-08-20T00:00:00.000Z' },
        { version: '0.3.2', publishedAt: '2026-08-10T00:00:00.000Z' },
      ]),
      packument('@awiki/dsh-model-proxy', [
        { version: '0.1.3', publishedAt: '2026-08-21T00:00:00.000Z', pluginRange: '^0.4.0' },
        { version: '0.1.2', publishedAt: '2026-08-10T00:00:00.000Z', pluginRange: '^0.3.1' },
      ]),
    )

    await expect(discoverDesktopAwikiUpdate({
      profileDir,
      request,
      policy: policy('0.3.3', '0.1.2'),
    })).resolves.toMatchObject({
      status: 'available',
      current: { pluginVersion: '0.3.2', modelProxyVersion: '0.1.2' },
      target: { pluginVersion: '0.3.3', modelProxyVersion: '0.1.2' },
    })
  })

  it('accepts Electron net.fetch responses whose url is empty', async () => {
    const profileDir = await profile()
    const request = registry(
      packument('@awiki/dsh-plugin', [
        { version: '0.3.3', publishedAt: '2026-08-20T00:00:00.000Z' },
      ]),
      packument('@awiki/dsh-model-proxy', [
        { version: '0.1.2', publishedAt: '2026-08-10T00:00:00.000Z', pluginRange: '^0.3.1' },
      ]),
      () => '',
    )

    await expect(discoverDesktopAwikiUpdate({
      profileDir,
      request,
      policy: policy('0.3.3', '0.1.2'),
    })).resolves.toMatchObject({
      status: 'available',
      target: { pluginVersion: '0.3.3', modelProxyVersion: '0.1.2' },
    })
  })

  it('rejects a non-empty response url outside the official npm Registry', async () => {
    const profileDir = await profile()
    const request = registry(
      packument('@awiki/dsh-plugin', [
        { version: '0.3.3', publishedAt: '2026-08-20T00:00:00.000Z' },
      ]),
      packument('@awiki/dsh-model-proxy', [
        { version: '0.1.2', publishedAt: '2026-08-10T00:00:00.000Z', pluginRange: '^0.3.1' },
      ]),
      requestUrl => requestUrl.replace('registry.npmjs.org', 'registry.example.com'),
    )

    await expect(discoverDesktopAwikiUpdate({
      profileDir,
      request,
      policy: policy('0.3.3', '0.1.2'),
    })).rejects.toThrow('npm registry request failed')
  })

  it('makes an exact tenant-published target available without a second cooling window', async () => {
    const profileDir = await profile('0.3.3', '0.1.2')
    const request = registry(
      packument('@awiki/dsh-plugin', [
        { version: '0.3.4', publishedAt: '2026-08-25T11:00:00.000Z' },
        { version: '0.3.3', publishedAt: '2026-08-20T00:00:00.000Z' },
      ]),
      packument('@awiki/dsh-model-proxy', [
        { version: '0.1.2', publishedAt: '2026-08-10T00:00:00.000Z', pluginRange: '^0.3.1' },
      ]),
    )

    await expect(discoverDesktopAwikiUpdate({
      profileDir,
      request,
      policy: policy('0.3.4', '0.1.2'),
    })).resolves.toMatchObject({
      status: 'available',
      current: { pluginVersion: '0.3.3', modelProxyVersion: '0.1.2' },
      target: { pluginVersion: '0.3.4', modelProxyVersion: '0.1.2' },
    })
  })

  it('rejects a release with install scripts before it can become an update target', async () => {
    const profileDir = await profile()
    const request = registry(
      packument('@awiki/dsh-plugin', [
        { version: '0.3.3', publishedAt: '2026-08-20T00:00:00.000Z', scripts: { postinstall: 'unsafe' } },
      ]),
      packument('@awiki/dsh-model-proxy', [
        { version: '0.1.2', publishedAt: '2026-08-10T00:00:00.000Z', pluginRange: '^0.3.1' },
      ]),
    )

    await expect(discoverDesktopAwikiUpdate({
      profileDir,
      request,
      policy: policy('0.3.3', '0.1.2'),
    })).rejects.toThrow('no trusted stable AWiki release')
  })

  it('never offers a Registry pair that would downgrade either installed package', async () => {
    const profileDir = await profile('0.3.4', '0.1.2')
    const request = registry(
      packument('@awiki/dsh-plugin', [
        { version: '0.3.3', publishedAt: '2026-08-20T00:00:00.000Z' },
      ]),
      packument('@awiki/dsh-model-proxy', [
        { version: '0.1.2', publishedAt: '2026-08-10T00:00:00.000Z', pluginRange: '^0.3.1' },
      ]),
    )

    await expect(discoverDesktopAwikiUpdate({
      profileDir,
      request,
      policy: policy('0.3.3', '0.1.2'),
    })).resolves.toMatchObject({ status: 'up-to-date' })
  })

  it('keeps the trusted Registry origin fixed', () => {
    expect(awikiUpdateDiscoveryConstants.npmRegistryOrigin).toBe('https://registry.npmjs.org')
  })
})
