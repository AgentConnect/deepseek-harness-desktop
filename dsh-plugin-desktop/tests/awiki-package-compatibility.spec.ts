import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DesktopAwikiCompatibilityError,
  selectDesktopAwikiCompatibility,
} from '../src/awiki-package-compatibility.ts'

const roots: string[] = []

function fixture(): {
  readonly install: string
  readonly profile: string
  readonly options: { readonly installPackageUrl: string; readonly profilePackageUrl: string }
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-awiki-compatibility-'))
  roots.push(root)
  const install = join(root, 'install')
  const profile = join(root, 'profile')
  mkdirSync(install)
  mkdirSync(profile)
  writeFileSync(join(install, 'package.json'), '{"name":"desktop-install"}\n')
  writeFileSync(join(profile, 'package.json'), '{"name":"desktop-profile"}\n')
  return {
    install,
    profile,
    options: {
      installPackageUrl: pathToFileURL(join(install, 'package.json')).href,
      profilePackageUrl: pathToFileURL(join(profile, 'package.json')).href,
    },
  }
}

function installAwikiPair(root: string, pluginVersion: string, proxyVersion: string, range: string): void {
  for (const [name, manifest] of [
    ['@awiki/dsh-plugin', { name: '@awiki/dsh-plugin', version: pluginVersion }],
    ['@awiki/dsh-model-proxy', {
      name: '@awiki/dsh-model-proxy',
      version: proxyVersion,
      peerDependencies: { '@awiki/dsh-plugin': range },
    }],
  ] as const) {
    const directory = join(root, 'node_modules', ...name.split('/'))
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest)}\n`)
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('AWiki Desktop package compatibility', () => {
  it('keeps a compatible newest-wins selection without reporting a fallback', () => {
    const target = fixture()
    installAwikiPair(target.install, '0.3.1-rc.1', '0.1.1-rc.1', '^0.3.1-rc.1')
    installAwikiPair(target.profile, '0.3.2', '0.1.2', '^0.3.1')

    const result = selectDesktopAwikiCompatibility(target.options)

    expect(result.fallback).toBeUndefined()
    expect(Object.fromEntries(result.preferredSources)).toEqual({
      '@awiki/dsh-plugin': 'profile',
      '@awiki/dsh-model-proxy': 'profile',
    })
  })

  it('falls back to the complete built-in pair when independent selection would mix incompatible versions', () => {
    const target = fixture()
    installAwikiPair(target.install, '0.3.1-rc.1', '0.1.1-rc.1', '^0.3.1-rc.1')
    installAwikiPair(target.profile, '0.2.5', '0.2.0', '^0.4.0')

    const result = selectDesktopAwikiCompatibility(target.options)

    expect(result.fallback).toEqual({
      source: 'install',
      pluginVersion: '0.3.1-rc.1',
      modelProxyVersion: '0.1.1-rc.1',
      rejectedPluginVersion: '0.3.1-rc.1',
      rejectedModelProxyVersion: '0.2.0',
    })
    expect(Object.fromEntries(result.preferredSources)).toEqual({
      '@awiki/dsh-plugin': 'install',
      '@awiki/dsh-model-proxy': 'install',
    })
  })

  it('returns a structured error when neither source contains a compatible pair', () => {
    const target = fixture()
    installAwikiPair(target.install, '0.3.1', '0.1.1', '^0.4.0')
    installAwikiPair(target.profile, '0.2.5', '0.2.0', '^0.5.0')

    expect(() => selectDesktopAwikiCompatibility(target.options)).toThrowError(
      expect.objectContaining<Partial<DesktopAwikiCompatibilityError>>({
        name: 'DesktopAwikiCompatibilityError',
        issue: {
          pluginVersion: '0.3.1',
          modelProxyVersion: '0.2.0',
          requiredPluginRange: '^0.5.0',
        },
      }),
    )
  })

  it('fails safely when a peer range is missing instead of guessing compatibility', () => {
    const target = fixture()
    installAwikiPair(target.install, '0.3.1', '0.1.1', '')

    expect(() => selectDesktopAwikiCompatibility(target.options)).toThrow(DesktopAwikiCompatibilityError)
  })
})
