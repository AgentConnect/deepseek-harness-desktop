import { FuseV1Options, FuseVersion, type FuseConfig } from '@electron/fuses'
import { FuseState } from '@electron/fuses/dist/constants.js'
import { Arch } from 'builder-util'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  afterAllArtifactBuild,
  resolveFinalPackagedRuntimeContexts,
  verifyElectronExecutableFuses,
  type ElectronArtifactBuildResult,
  type ElectronFuseReader,
} from '../scripts/verify-electron-fuses.ts'
import type {
  PackagedElectronSmoke,
} from '../scripts/verify-packaged-runtime.ts'

const require = createRequire(import.meta.url)
// The installed CommonJS entry initializes the builder before its private target factory.
const { LinuxPackager } = require('app-builder-lib')
const { createTargets } = require('app-builder-lib/out/targets/targetFactory.js')

function result(
  platforms: readonly {
    readonly archs: readonly number[]
    readonly key: string
  }[],
  configuration: ElectronArtifactBuildResult['configuration'] = {
    productName: 'DSH Desktop Beta',
  },
): ElectronArtifactBuildResult {
  return {
    outDir: '/build',
    configuration,
    platformToTargets: new Map(
      platforms.map(({ archs, key }) => [
        { buildConfigurationKey: key },
        new Map(archs.map(arch => [arch, []])),
      ]),
    ),
  }
}

function fuseWire(overrides: Partial<Record<FuseV1Options, FuseState>> = {}): FuseConfig<FuseState> {
  return {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: FuseState.ENABLE,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE,
    [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE,
    ...overrides,
  }
}

describe('final Electron fuse verification', () => {
  it('recovers an explicit cross-architecture dir request from the actual Linux empty target map without checking stale siblings', () => {
    // LinuxPackager omits dir entirely, rather than retaining a NoOpTarget in this map.
    const targets = new Map<string, unknown>()
    expect(createTargets(targets, ['dir'], '/build', Object.create(LinuxPackager.prototype))).toEqual([])
    expect(targets.size).toBe(0)
    const arch = process.arch === 'arm64' ? Arch.x64 : Arch.arm64
    const name = Arch[arch]
    const directory = arch === Arch.x64 ? 'linux-unpacked' : 'linux-arm64-unpacked'
    const executable = join('/build', directory, 'dsh-plugin-desktop-beta')
    const exists = vi.fn(() => true)
    const built = {
      outDir: '/build',
      configuration: { asar: false, linux: { target: `dir:${name}` } },
      platformToTargets: new Map([[{ buildConfigurationKey: 'linux' }, targets]]),
    } satisfies ElectronArtifactBuildResult

    expect(resolveFinalPackagedRuntimeContexts(built, exists)).toEqual([
      expect.objectContaining({ appOutDir: join('/build', directory), arch }),
    ])
    expect(exists.mock.calls).toEqual([[executable]])
  })

  it.each([
    undefined,
    { defaultArch: 'arm64' },
    { target: 'dir' },
    { target: { target: 'dir', arch: [] } },
    { target: [{ target: 'dir', arch: 'arm64' }, 'dir'] },
    { target: ['dir:arm64', 'AppImage:x64'] },
    { target: 'AppImage:arm64' },
  ])('rejects an empty target map without a complete unambiguous directory architecture request: %j', linux => {
    const exists = vi.fn(() => true)
    const built = {
      outDir: '/build',
      configuration: linux === undefined ? {} : { linux },
      platformToTargets: new Map([[{ buildConfigurationKey: 'linux' }, new Map()]]),
    } satisfies ElectronArtifactBuildResult

    expect(() => resolveFinalPackagedRuntimeContexts(built, exists))
      .toThrow('cannot determine requested Electron architecture(s) for linux')
    expect(exists).not.toHaveBeenCalled()
  })

  it('requires every explicitly requested directory architecture even when a stale sibling exists', () => {
    const built = {
      outDir: '/build',
      configuration: { linux: { target: { target: 'dir', arch: ['x64', 'arm64'] } } },
      platformToTargets: new Map([[{ buildConfigurationKey: 'linux' }, new Map()]]),
    } satisfies ElectronArtifactBuildResult
    const x64 = join('/build', 'linux-unpacked', 'dsh-plugin-desktop-beta')

    expect(() => resolveFinalPackagedRuntimeContexts(built, filename => filename === x64))
      .toThrow(`linux/arm64 at ${join('/build', 'linux-arm64-unpacked', 'dsh-plugin-desktop-beta')}`)
  })

  it('continues checking fuses and running the packaged smoke for an explicit empty-map directory result', async () => {
    const built = {
      outDir: '/build',
      configuration: { asar: false, linux: { target: 'dir:x64' } },
      platformToTargets: new Map([[{ buildConfigurationKey: 'linux' }, new Map()]]),
    } satisfies ElectronArtifactBuildResult
    const read = vi.fn<ElectronFuseReader>(async () => fuseWire({
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.DISABLE,
      [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.DISABLE,
    }))
    const smoke = vi.fn<PackagedElectronSmoke>()

    await expect(afterAllArtifactBuild(built, read, () => true, smoke)).resolves.toEqual([])
    expect(read).toHaveBeenCalledWith(join('/build', 'linux-unpacked', 'dsh-plugin-desktop-beta'))
    expect(smoke).toHaveBeenCalledWith(expect.objectContaining({ arch: Arch.x64, electronPlatformName: 'linux' }))
  })

  it('maps only requested platform and architecture keys to complete runtime contexts', () => {
    const expected = [
      join('/build', 'linux-unpacked', 'dsh-plugin-desktop-beta'),
      join('/build', 'mac-universal', 'DSH Desktop Beta.app', 'Contents', 'MacOS', 'DSH Desktop Beta'),
      join('/build', 'win-unpacked', 'DSH Desktop Beta.exe'),
      join('/build', 'win-arm64-unpacked', 'DSH Desktop Beta.exe'),
    ].sort()

    expect(resolveFinalPackagedRuntimeContexts(
      result([
        { key: 'mac', archs: [Arch.universal] },
        { key: 'win', archs: [Arch.x64, Arch.arm64] },
        { key: 'linux', archs: [Arch.x64] },
      ]),
      filename => expected.includes(filename),
    )).toEqual([
      {
        appOutDir: join('/build', 'linux-unpacked'),
        arch: 1,
        electronPlatformName: 'linux',
        packager: {
          executableName: 'dsh-plugin-desktop-beta',
          appInfo: { productFilename: 'DSH Desktop Beta' },
        },
      },
      {
        appOutDir: join('/build', 'mac-universal'),
        arch: 4,
        electronPlatformName: 'darwin',
        packager: { appInfo: { productFilename: 'DSH Desktop Beta' } },
      },
      {
        appOutDir: join('/build', 'win-arm64-unpacked'),
        arch: 3,
        electronPlatformName: 'win32',
        packager: { appInfo: { productFilename: 'DSH Desktop Beta' } },
      },
      {
        appOutDir: join('/build', 'win-unpacked'),
        arch: 1,
        electronPlatformName: 'win32',
        packager: { appInfo: { productFilename: 'DSH Desktop Beta' } },
      },
    ])
  })

  it.each(['mac', 'win', 'linux'] as const)('propagates global directory packaging to final %s fuse checks', key => {
    const configured = result([{ key, archs: [Arch.x64] }], { asar: false })
    const contexts = resolveFinalPackagedRuntimeContexts(configured, () => true)
    expect(contexts[0]?.packager.platformSpecificBuildOptions?.asar).toBe(false)
  })

  it('honors Linux executableName and recovers a configured suffixless architecture', () => {
    const configured = result([{ key: 'linux', archs: [Arch.arm64] }], {
      productName: 'DSH Desktop Beta',
      linux: { defaultArch: 'arm64', executableName: 'dsh-desktop' },
    })
    const executable = join('/build', 'linux-unpacked', 'dsh-desktop')

    expect(resolveFinalPackagedRuntimeContexts(
      configured,
      filename => filename === executable,
    )).toEqual([{
      appOutDir: join('/build', 'linux-unpacked'),
      arch: 3,
      electronPlatformName: 'linux',
      packager: {
        executableName: 'dsh-desktop',
        appInfo: { productFilename: 'dsh-desktop' },
      },
    }])
  })

  it.each([
    ['mac', 'mac', 'darwin', 1],
    ['mac-arm64', 'mac', 'darwin', 3],
    ['mac-universal', 'mac', 'darwin', 4],
    ['win-ia32-unpacked', 'win', 'win32', 0],
    ['linux-armv7l-unpacked', 'linux', 'linux', 2],
  ] as const)(
    'maps %s to its platform, architecture, and appOutDir',
    (directory, key, platform, arch) => {
      expect(resolveFinalPackagedRuntimeContexts(
        result([{ key, archs: [arch] }]),
        () => true,
      )).toEqual([expect.objectContaining({
        appOutDir: join('/build', directory),
        arch,
        electronPlatformName: platform,
      })])
    },
  )

  it('rejects an unsupported configured default architecture', () => {
    expect(() => resolveFinalPackagedRuntimeContexts(
      result([{ key: 'linux', archs: [Arch.x64] }], {
        linux: { defaultArch: 'mips64' },
      }),
      () => true,
    )).toThrow('unsupported Electron linux output default architecture "mips64"')
  })

  it('ignores a stale sibling architecture from an earlier build', () => {
    const expected = join('/build', 'win-unpacked', 'DSH Desktop Beta.exe')
    const stale = join('/build', 'win-arm64-unpacked', 'DSH Desktop Beta.exe')
    const exists = vi.fn((filename: string) => filename === expected || filename === stale)

    expect(resolveFinalPackagedRuntimeContexts(
      result([{ key: 'win', archs: [Arch.x64] }]),
      exists,
    )).toEqual([expect.objectContaining({
      appOutDir: join('/build', 'win-unpacked'),
      arch: Arch.x64,
    })])
    expect(exists).toHaveBeenCalledTimes(1)
    expect(exists).toHaveBeenCalledWith(expected)
    expect(exists).not.toHaveBeenCalledWith(stale)
  })

  it('fails when one requested architecture is missing even if a sibling exists', () => {
    const x64Executable = join('/build', 'win-unpacked', 'DSH Desktop Beta.exe')

    expect(() => resolveFinalPackagedRuntimeContexts(
      result([{ key: 'win', archs: [Arch.x64, Arch.arm64] }]),
      filename => filename === x64Executable,
    )).toThrow(`win/arm64 at ${join('/build', 'win-arm64-unpacked', 'DSH Desktop Beta.exe')}`)
  })

  it('resolves a real target-name map through the target archs retained by NSIS', () => {
    const platform = { buildConfigurationKey: 'win' }
    const built = {
      outDir: '/build',
      configuration: { productName: 'DSH Desktop Beta' },
      platformToTargets: new Map([[platform, new Map([
        ['nsis', { archs: new Map([
          [Arch.x64, '/build/win-unpacked'],
          [Arch.arm64, '/build/win-arm64-unpacked'],
        ]) }],
      ])]]),
    } satisfies ElectronArtifactBuildResult

    expect(resolveFinalPackagedRuntimeContexts(built, () => true))
      .toEqual([
        expect.objectContaining({ appOutDir: join('/build', 'win-arm64-unpacked'), arch: Arch.arm64 }),
        expect.objectContaining({ appOutDir: join('/build', 'win-unpacked'), arch: Arch.x64 }),
      ])
  })

  it('resolves mac universal from the target packager request and ignores component outputs', () => {
    const platform = { buildConfigurationKey: 'mac' }
    const requestedTargets = new Map([[platform, new Map([
      [Arch.universal, ['dmg']],
    ])]])
    const built = {
      outDir: '/build',
      configuration: { productName: 'DSH Desktop Beta' },
      platformToTargets: new Map([[platform, new Map([
        ['dmg', { packager: { packagerOptions: { targets: requestedTargets } } }],
      ])]]),
    } satisfies ElectronArtifactBuildResult
    const universalExecutable = join(
      '/build',
      'mac-universal',
      'DSH Desktop Beta.app',
      'Contents',
      'MacOS',
      'DSH Desktop Beta',
    )
    const exists = vi.fn((filename: string) => filename === universalExecutable)

    expect(resolveFinalPackagedRuntimeContexts(built, exists)).toEqual([
      expect.objectContaining({ appOutDir: join('/build', 'mac-universal'), arch: Arch.universal }),
    ])
    expect(exists).toHaveBeenCalledTimes(1)
    expect(exists).toHaveBeenCalledWith(universalExecutable)
  })

  it('checks every requested final executable after all artifact builds', async () => {
    const executables = [
      join('/build', 'mac-arm64', 'DSH Desktop Beta.app', 'Contents', 'MacOS', 'DSH Desktop Beta'),
      join('/build', 'mac', 'DSH Desktop Beta.app', 'Contents', 'MacOS', 'DSH Desktop Beta'),
    ]
    const events: string[] = []
    const read = vi.fn<ElectronFuseReader>(async (executable) => {
      events.push(`fuse:${executable}`)
      return fuseWire()
    })
    const smoke = vi.fn<PackagedElectronSmoke>((runtimeContext) => {
      events.push(`smoke:${runtimeContext.appOutDir}`)
    })

    await expect(afterAllArtifactBuild(
      result([{ key: 'mac', archs: [Arch.arm64, Arch.x64] }]),
      read,
      filename => executables.includes(filename),
      smoke,
    )).resolves.toEqual([])
    expect(read.mock.calls.map(call => call[0]).sort()).toEqual(executables.sort())
    expect(smoke.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ appOutDir: join('/build', 'mac'), arch: Arch.x64 }),
      expect.objectContaining({ appOutDir: join('/build', 'mac-arm64'), arch: 3 }),
    ])
    expect(events).toEqual([
      `fuse:${executables[1]}`,
      `smoke:${join('/build', 'mac')}`,
      `fuse:${executables[0]}`,
      `smoke:${join('/build', 'mac-arm64')}`,
    ])
  })

  it.each([
    [FuseV1Options.RunAsNode, 'RunAsNode'],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, 'EnableEmbeddedAsarIntegrityValidation'],
    [FuseV1Options.OnlyLoadAppFromAsar, 'OnlyLoadAppFromAsar'],
  ])('fails loud when required fuse %s is not enabled', async (option, name) => {
    const read: ElectronFuseReader = async () => fuseWire({ [option]: FuseState.DISABLE })

    await expect(verifyElectronExecutableFuses('/build/DSH Desktop Beta.exe', read))
      .rejects.toThrow(`${name}=DISABLE`)
  })

  it('requires both ASAR fuses disabled for directory packages', async () => {
    const disabled = {
      [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.DISABLE,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.DISABLE,
    }
    await expect(verifyElectronExecutableFuses('/build/app', async () => fuseWire(disabled), false))
      .resolves.toBeUndefined()
    for (const option of [FuseV1Options.OnlyLoadAppFromAsar, FuseV1Options.EnableEmbeddedAsarIntegrityValidation]) {
      await expect(verifyElectronExecutableFuses('/build/app', async () => fuseWire({
        ...disabled, [option]: FuseState.ENABLE,
      }), false)).rejects.toThrow('invalid required fuses')
    }
  })

  it('wraps an unreadable final executable with its resolved path', async () => {
    const read: ElectronFuseReader = async () => { throw new Error('missing sentinel') }

    await expect(verifyElectronExecutableFuses('/build/DSH Desktop Beta.exe', read))
      .rejects.toThrow('/build/DSH Desktop Beta.exe')
  })
})
