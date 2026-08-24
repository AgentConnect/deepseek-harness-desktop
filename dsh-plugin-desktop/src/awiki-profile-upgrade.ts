/** Protected, all-or-nothing upgrade of the Desktop-owned AWiki package pair. */

import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  AWIKI_MODEL_PROXY_PACKAGE,
  AWIKI_PLUGIN_PACKAGE,
  type DesktopAwikiCompatibilityFallback,
} from './awiki-package-compatibility.ts'
import type {
  BeginDesktopInstallRecoveryInput,
  DesktopInstallRecoveryRestoreResult,
  DesktopInstallRecoveryTransaction,
} from './install-recovery.ts'

const MAX_PROFILE_MANIFEST_BYTES = 1024 * 1024

interface ProfileManifest {
  dependencies?: Record<string, unknown>
  [key: string]: unknown
}

export interface DesktopAwikiProfileVersions {
  readonly pluginVersion: string
  readonly modelProxyVersion: string
}

export interface DesktopAwikiUpgradeRecovery {
  begin(input: BeginDesktopInstallRecoveryInput): Promise<DesktopInstallRecoveryTransaction>
  seal(transactionId: string): Promise<DesktopInstallRecoveryTransaction>
  restoreCurrentInstall(
    transactionId: string,
    failureReason: 'install-failed',
  ): Promise<DesktopInstallRecoveryRestoreResult>
  clear(transactionId: string): Promise<void>
}

export interface DesktopAwikiProfileUpgradeOptions {
  readonly profileDir: string
  readonly target: DesktopAwikiProfileVersions
  readonly receiptId: string
  readonly recovery: DesktopAwikiUpgradeRecovery
  readonly materialize: (updateLockfile: boolean) => Promise<void>
  readonly verify: () => DesktopAwikiCompatibilityFallback | undefined
}

export type DesktopAwikiProfileUpgradeResult =
  | { readonly status: 'upgraded'; readonly transaction: DesktopInstallRecoveryTransaction }
  | {
      readonly status: 'failed'
      readonly cause: unknown
      readonly rollback: 'restored' | 'manual-recovery-required' | 'failed'
      readonly rollbackCause?: unknown
    }

function parseManifest(text: string): ProfileManifest {
  if (Buffer.byteLength(text) > MAX_PROFILE_MANIFEST_BYTES) {
    throw new Error('dsh-plugin-desktop: Profile package.json is too large to upgrade safely')
  }
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('dsh-plugin-desktop: Profile package.json must contain an object')
  }
  const manifest = parsed as ProfileManifest
  if (manifest.dependencies !== undefined
    && (manifest.dependencies === null
      || typeof manifest.dependencies !== 'object'
      || Array.isArray(manifest.dependencies))) {
    throw new Error('dsh-plugin-desktop: Profile dependencies must contain an object')
  }
  return manifest
}

/** Read the two declarative Profile versions displayed in the native choice dialog. */
export async function readDesktopAwikiProfileVersions(
  profileDir: string,
): Promise<Partial<DesktopAwikiProfileVersions>> {
  const manifest = parseManifest(await readFile(join(profileDir, 'package.json'), 'utf8'))
  const dependencies = manifest.dependencies ?? {}
  return {
    ...(typeof dependencies[AWIKI_PLUGIN_PACKAGE] === 'string'
      ? { pluginVersion: dependencies[AWIKI_PLUGIN_PACKAGE] }
      : {}),
    ...(typeof dependencies[AWIKI_MODEL_PROXY_PACKAGE] === 'string'
      ? { modelProxyVersion: dependencies[AWIKI_MODEL_PROXY_PACKAGE] }
      : {}),
  }
}

/** Persist both exact targets in one atomic manifest replacement. */
export async function writeDesktopAwikiProfileVersions(
  profileDir: string,
  target: DesktopAwikiProfileVersions,
): Promise<void> {
  const manifestPath = join(profileDir, 'package.json')
  const [text, info] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    lstat(manifestPath),
  ])
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('dsh-plugin-desktop: Profile package.json must be a regular file')
  }
  const manifest = parseManifest(text)
  manifest.dependencies = {
    ...(manifest.dependencies ?? {}),
    [AWIKI_PLUGIN_PACKAGE]: target.pluginVersion,
    [AWIKI_MODEL_PROXY_PACKAGE]: target.modelProxyVersion,
  }
  await writeFileAtomic(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`, {
    mode: info.mode & 0o777,
  })
}

/**
 * Upgrade and materialize the pair under the existing crash-recovery WAL.
 * A successful result deliberately stays sealed for verification after restart.
 */
export async function upgradeDesktopAwikiProfile(
  options: DesktopAwikiProfileUpgradeOptions,
): Promise<DesktopAwikiProfileUpgradeResult> {
  let transaction: DesktopInstallRecoveryTransaction | undefined
  try {
    transaction = await options.recovery.begin({
      packageName: AWIKI_PLUGIN_PACKAGE,
      packageVersion: `${options.target.pluginVersion} + ${AWIKI_MODEL_PROXY_PACKAGE}@${options.target.modelProxyVersion}`,
      receiptId: options.receiptId,
    })
    await writeDesktopAwikiProfileVersions(options.profileDir, options.target)
    await options.materialize(true)
    const fallback = options.verify()
    if (fallback !== undefined) {
      throw new Error('dsh-plugin-desktop: AWiki packages remain incompatible after upgrade')
    }
    return { status: 'upgraded', transaction: await options.recovery.seal(transaction.transactionId) }
  } catch (cause) {
    if (transaction === undefined) return { status: 'failed', cause, rollback: 'failed' }
    try {
      const restored = await options.recovery.restoreCurrentInstall(transaction.transactionId, 'install-failed')
      if (restored.status === 'manual-recovery-required') {
        return { status: 'failed', cause, rollback: 'manual-recovery-required' }
      }
      try {
        await options.materialize(false)
        await options.recovery.clear(transaction.transactionId)
        return { status: 'failed', cause, rollback: 'restored' }
      } catch (rollbackCause) {
        return { status: 'failed', cause, rollback: 'failed', rollbackCause }
      }
    } catch (rollbackCause) {
      return { status: 'failed', cause, rollback: 'failed', rollbackCause }
    }
  }
}
