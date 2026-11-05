import { describe, expect, it, vi } from 'vitest'
import { Arch, archFromString } from 'builder-util'
import { createRequire } from 'node:module'
// @ts-expect-error package-dir deliberately remains a directly executable ESM script.
import { packageDirectory, UNSIGNED_DIRECTORY_BUILD_ARGS, unsignedDirectoryBuildEnvironment } from '../scripts/package-dir.mjs'

const require = createRequire(import.meta.url)
const { Platform } = require('app-builder-lib')
const { configureBuildCommand, normalizeOptions } = require('electron-builder/out/builder.js')
const yargs = require('yargs/yargs')

describe('unsigned directory packaging', () => {
  it('removes release secrets while preserving ordinary build inputs', () => {
    const environment = unsignedDirectoryBuildEnvironment({
      APPLE_API_KEY: '/tmp/private.p8',
      APPLE_ID: 'release@example.com',
      CSC_KEY_PASSWORD: 'secret',
      CSC_LINK: '/tmp/release.p12',
      CSC_NAME: 'Developer ID Application: Release',
      MAC_CERT_P12_BASE64: 'private',
      WIN_CSC_KEY_PASSWORD: 'secret',
      WIN_CSC_LINK: '/tmp/windows.pfx',
      DSH_PACKAGE_CHECK_ALREADY_RAN: '1',
    })

    expect(environment).toEqual({
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      DSH_PACKAGE_CHECK_ALREADY_RAN: '1',
      DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
    })
  })

  it('passes explicit unsigned and no-notarization overrides to Electron Builder', () => {
    const run = vi.fn(() => ({ status: 0 }))

    packageDirectory({
      cwd: '/workspace/desktop',
      electronBuilderCli: '/workspace/electron-builder.js',
      electronDistPath: '/workspace/electron/dist',
      env: { CSC_NAME: 'Developer ID Application: Release', KEEP: 'yes' },
      nodeExecutable: '/runtime/node',
      run: run as unknown as typeof import('node:child_process').spawnSync,
    })

    expect(UNSIGNED_DIRECTORY_BUILD_ARGS).toEqual([
      '--dir',
      '--publish',
      'never',
      '--config.forceCodeSigning=false',
      '--config.mac.identity=null',
      '--config.mac.notarize=false',
      '--config.win.signExecutable=false',
    ])
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(
      '/runtime/node',
      [
        '/workspace/electron-builder.js',
        ...UNSIGNED_DIRECTORY_BUILD_ARGS,
        `--${Arch[archFromString(process.arch)]}`,
        `--config.${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}.target=dir:${Arch[archFromString(process.arch)]}`,
        '--config.electronDist=/workspace/electron/dist',
      ],
      {
        cwd: '/workspace/desktop',
        env: {
          CSC_IDENTITY_AUTO_DISCOVERY: 'false',
          DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
          KEEP: 'yes',
        },
        stdio: 'inherit',
      },
    )
  })

  it('preserves the same explicit current architecture in the actual builder request and final hook configuration', () => {
    const run = vi.fn(() => ({ status: 0 }))
    packageDirectory({ electronBuilderCli: '/builder.js', electronDistPath: '/electron/dist', run })
    const invocation = run.mock.calls[0] as unknown as [string, string[]]
    const parsed = configureBuildCommand(yargs(invocation[1].slice(1)).exitProcess(false)).parse()
    const normalized = normalizeOptions(parsed)
    const platform = Platform.current()

    expect([...normalized.targets!.get(platform)!.entries()]).toEqual([[archFromString(process.arch), ['dir']]])
    expect((normalized.config as Record<string, { target?: string }>)[platform.buildConfigurationKey]?.target)
      .toBe(`dir:${Arch[archFromString(process.arch)]}`)
  })

  it('propagates spawn failures and non-zero exits', () => {
    const failure = new Error('cannot spawn')
    expect(() => packageDirectory({
      run: (() => ({ error: failure })) as unknown as typeof import('node:child_process').spawnSync,
    })).toThrow(failure)
    expect(() => packageDirectory({
      run: (() => ({ status: 7 })) as unknown as typeof import('node:child_process').spawnSync,
    })).toThrow('electron-builder --dir exited with 7')
  })
})
