import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readDesktopAwikiProfileVersions,
  upgradeDesktopAwikiProfile,
} from '../src/awiki-profile-upgrade.ts'
import {
  DesktopInstallRecoveryStore,
  desktopInstallRecoveryStatePath,
} from '../src/install-recovery.ts'

const roots: string[] = []

function fixture(): {
  readonly root: string
  readonly profileDir: string
  readonly recovery: DesktopInstallRecoveryStore
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-awiki-profile-upgrade-'))
  roots.push(root)
  const profileDir = join(root, 'profiles', 'desktop')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'desktop-profile',
    private: true,
    dependencies: {
      existing: '1.0.0',
      '@awiki/dsh-plugin': '0.2.5',
      '@awiki/dsh-model-proxy': '0.2.0',
    },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  return {
    root,
    profileDir,
    recovery: new DesktopInstallRecoveryStore({
      statePath: desktopInstallRecoveryStatePath(join(root, 'user-data')),
      profileName: 'desktop',
      profileDir,
      generationId: 'generation-test-1',
    }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('AWiki Profile pair upgrade', () => {
  it('updates both packages together and seals restart verification', async () => {
    const target = fixture()
    const materialize = vi.fn(async (updateLockfile: boolean) => {
      expect(updateLockfile).toBe(true)
      writeFileSync(join(target.profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nupdated: true\n')
    })

    const result = await upgradeDesktopAwikiProfile({
      profileDir: target.profileDir,
      target: { pluginVersion: '0.3.2', modelProxyVersion: '0.1.2' },
      receiptId: 'awiki-pair:test-success',
      recovery: target.recovery,
      materialize,
      verify: () => undefined,
    })

    expect(result.status).toBe('upgraded')
    expect(await readDesktopAwikiProfileVersions(target.profileDir)).toEqual({
      pluginVersion: '0.3.2',
      modelProxyVersion: '0.1.2',
    })
    expect(JSON.parse(readFileSync(join(target.profileDir, 'package.json'), 'utf8')).dependencies)
      .toMatchObject({ existing: '1.0.0' })
    expect(await target.recovery.read()).toMatchObject({
      phase: 'awaiting-restart',
      packageName: '@awiki/dsh-plugin',
      packageVersion: '0.3.2 + @awiki/dsh-model-proxy@0.1.2',
    })
  })

  it('restores the exact manifest and lockfile when materialization fails', async () => {
    const target = fixture()
    const originalManifest = readFileSync(join(target.profileDir, 'package.json'), 'utf8')
    const originalLockfile = readFileSync(join(target.profileDir, 'pnpm-lock.yaml'), 'utf8')
    const materialize = vi.fn(async (updateLockfile: boolean) => {
      if (updateLockfile) {
        writeFileSync(join(target.profileDir, 'pnpm-lock.yaml'), 'partially changed\n')
        throw new Error('registry unavailable')
      }
    })

    const result = await upgradeDesktopAwikiProfile({
      profileDir: target.profileDir,
      target: { pluginVersion: '0.3.2', modelProxyVersion: '0.1.2' },
      receiptId: 'awiki-pair:test-rollback',
      recovery: target.recovery,
      materialize,
      verify: () => undefined,
    })

    expect(result).toMatchObject({ status: 'failed', rollback: 'restored' })
    expect(materialize.mock.calls).toEqual([[true], [false]])
    expect(readFileSync(join(target.profileDir, 'package.json'), 'utf8')).toBe(originalManifest)
    expect(readFileSync(join(target.profileDir, 'pnpm-lock.yaml'), 'utf8')).toBe(originalLockfile)
    expect(await target.recovery.read()).toBeUndefined()
  })

  it('rolls back when post-install compatibility verification still reports a fallback', async () => {
    const target = fixture()

    const result = await upgradeDesktopAwikiProfile({
      profileDir: target.profileDir,
      target: { pluginVersion: '0.3.2', modelProxyVersion: '0.1.2' },
      receiptId: 'awiki-pair:test-verification',
      recovery: target.recovery,
      materialize: async () => {},
      verify: () => ({
        source: 'install',
        pluginVersion: '0.3.2',
        modelProxyVersion: '0.1.2',
        rejectedPluginVersion: '0.3.2',
        rejectedModelProxyVersion: '0.2.0',
      }),
    })

    expect(result).toMatchObject({ status: 'failed', rollback: 'restored' })
    expect(await readDesktopAwikiProfileVersions(target.profileDir)).toEqual({
      pluginVersion: '0.2.5',
      modelProxyVersion: '0.2.0',
    })
  })
})
