import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  MACOS_UNIVERSAL_NATIVE_ENTRIES,
  prepareMacUniversalRuntime,
} from '../scripts/mac-universal.ts'

describe('universal macOS native runtime preparation', () => {
  it.each([
    'node_modules/@awiki/im-core-node-darwin-arm64/awiki-im-core-node.darwin-arm64.node',
    'node_modules/@awiki/im-core-node-darwin-x64/awiki-im-core-node.darwin-x64.node',
    'node_modules/@agent-network-protocol/anp-identity-darwin-arm64/anp-identity.darwin-arm64.node',
    'node_modules/@agent-network-protocol/anp-identity-darwin-x64/anp-identity.darwin-x64.node',
  ])('rejects an incomplete AWiki or Identity architecture: %s', (missing) => {
    const desktopRoot = resolve('/desktop')
    expect(() => prepareMacUniversalRuntime({
      desktopRoot,
      exists: path => path !== join(desktopRoot, missing),
      chmod: vi.fn(),
    })).toThrow(join(desktopRoot, missing))
  })

  it('tracks the Electron 43 fs-ext binding for both CPU architectures', () => {
    expect(MACOS_UNIVERSAL_NATIVE_ENTRIES).toEqual(expect.arrayContaining([
      {
        arch: 'arm64',
        path: 'node_modules/fs-ext/prebuilds/darwin-arm64/electron.abi148.node',
      },
      {
        arch: 'x86_64',
        path: 'node_modules/fs-ext/prebuilds/darwin-x64/electron.abi148.node',
      },
    ]))
  })

  it('requires every CPU-specific file and repairs both node-pty helpers', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')

    prepareMacUniversalRuntime({ desktopRoot, exists: () => true, chmod })

    expect(chmod.mock.calls).toEqual([
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 0o755],
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper'), 0o755],
    ])
  })

  it('fails before changing permissions when one architecture is incomplete', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')
    const missing = MACOS_UNIVERSAL_NATIVE_ENTRIES.at(-1)!.path

    expect(() => prepareMacUniversalRuntime({
      desktopRoot,
      exists: path => path !== join(desktopRoot, missing),
      chmod,
    })).toThrow(join(desktopRoot, missing))
    expect(chmod).not.toHaveBeenCalled()
  })
})
