import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readDesktopAwikiProfileVersions,
  upgradeDesktopAwikiProfile,
} from '../src/awiki-profile-upgrade.ts'
import { DesktopProfileCheckpoint } from '../src/profile-checkpoint.ts'

const roots: string[] = []

function fixture(): {
  readonly root: string
  readonly profileDir: string
  readonly checkpoint: DesktopProfileCheckpoint
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
  mkdirSync(join(root, 'user-data'), { recursive: true })
  const checkpoint = new DesktopProfileCheckpoint({ userDataDir: join(root, 'user-data'), profileName: 'desktop', profileDir, homeDir: root })
  checkpoint.captureHealthy()
  return { root, profileDir, checkpoint }

}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('AWiki Profile pair upgrade', () => {
  it('updates both packages together while retaining the last healthy checkpoint', async () => {
    const target = fixture()
    const materialize = vi.fn(async (updateLockfile: boolean) => {
      expect(updateLockfile).toBe(true)
      writeFileSync(join(target.profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nupdated: true\n')
    })

    const result = await upgradeDesktopAwikiProfile({
      profileDir: target.profileDir,
      target: { pluginVersion: '0.3.2', modelProxyVersion: '0.1.2' },
      checkpoint: target.checkpoint,
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
    expect(target.checkpoint.listSlots().filter(slot => slot.snapshotExists)).toHaveLength(1)
    expect(target.checkpoint.inspectSlot(target.checkpoint.listSlots().find(slot => slot.snapshotExists)!.slotId).currentDiffers).toBe(true)
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
      checkpoint: target.checkpoint,
      materialize,
      verify: () => undefined,
    })

    expect(result).toMatchObject({ status: 'failed', rollback: 'restored' })
    expect(materialize.mock.calls).toEqual([[true], [false]])
    expect(readFileSync(join(target.profileDir, 'package.json'), 'utf8')).toBe(originalManifest)
    expect(readFileSync(join(target.profileDir, 'pnpm-lock.yaml'), 'utf8')).toBe(originalLockfile)
    expect(target.checkpoint.inspectSlot(target.checkpoint.listSlots().find(slot => slot.snapshotExists)!.slotId).currentDiffers).toBe(false)
  })

  it('rolls back when post-install compatibility verification still reports a fallback', async () => {
    const target = fixture()

    const result = await upgradeDesktopAwikiProfile({
      profileDir: target.profileDir,
      target: { pluginVersion: '0.3.2', modelProxyVersion: '0.1.2' },
      checkpoint: target.checkpoint,
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
  it('refuses to overwrite concurrent Profile edits during failed installation', async () => {
    const target = fixture()
    const result = await upgradeDesktopAwikiProfile({
      profileDir: target.profileDir, target: { pluginVersion: '0.3.2', modelProxyVersion: '0.1.2' }, checkpoint: target.checkpoint,
      materialize: async () => {
        writeFileSync(join(target.profileDir, 'cordis.patch.yml'), '# concurrent user edit\n')
        throw new Error('install failed')
      }, verify: () => undefined,
    })
    expect(result).toMatchObject({ status: 'failed', rollback: 'manual-recovery-required' })
    expect(readFileSync(join(target.profileDir, 'cordis.patch.yml'), 'utf8')).toBe('# concurrent user edit\n')
  })

  it('requires the current Profile to match a healthy checkpoint before writing either dependency', async () => {
    const target = fixture()
    writeFileSync(join(target.profileDir, 'cordis.patch.yml'), '# not yet verified\n')
    const before = readFileSync(join(target.profileDir, 'package.json'), 'utf8')
    const materialize = vi.fn(async () => {})
    const result = await upgradeDesktopAwikiProfile({ profileDir: target.profileDir, target: { pluginVersion: '0.3.2', modelProxyVersion: '0.1.2' }, checkpoint: target.checkpoint, materialize, verify: () => undefined })
    expect(result.status).toBe('failed')
    expect(materialize).not.toHaveBeenCalled()
    expect(readFileSync(join(target.profileDir, 'package.json'), 'utf8')).toBe(before)
  })

})
