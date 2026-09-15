/** Headless cross-repository gate for an unpublished tenant-aware AWiki package pair. */

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyAwikiDirectCandidate } from './awiki-direct-candidate.mjs'

const direct = process.argv.includes('--direct')
if (process.argv.slice(2).some(arg => arg !== '--direct')) throw new Error('unknown source verification argument')

const sourceInput = process.env.DSH_AWIKI_TENANT_SOURCE_ROOT
if (sourceInput === undefined || !isAbsolute(sourceInput)) {
  throw new Error('DSH_AWIKI_TENANT_SOURCE_ROOT must be the absolute local dsh-awiki source root')
}
const sourceRoot = realpathSync(sourceInput)
if (!statSync(sourceRoot).isDirectory()) throw new Error('AWiki tenant source root must be a directory')

const desktopRoot = fileURLToPath(new URL('../', import.meta.url))
const desktopManifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
const pluginManifest = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'))
const proxyRoot = join(sourceRoot, 'packages', 'dsh-model-proxy')
const proxyManifest = JSON.parse(readFileSync(join(proxyRoot, 'package.json'), 'utf8'))

if (pluginManifest.name !== '@awiki/dsh-plugin'
  || proxyManifest.name !== '@awiki/dsh-model-proxy') {
  throw new Error('AWiki tenant source root does not contain the expected package pair')
}
if (typeof desktopManifest.dependencies?.['@awiki/dsh-plugin'] !== 'string'
  || typeof desktopManifest.dependencies?.['@awiki/dsh-model-proxy'] !== 'string') {
  throw new Error('Desktop must retain exact installable AWiki package pins')
}

const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const environment = { ...process.env, CARGO_INCREMENTAL: '0' }
execFileSync(corepack, [
  'pnpm', 'exec', 'vitest', 'run',
  ...(direct ? [
    'tests/provider.spec.ts', 'tests/sdk-adapter.spec.ts', 'tests/controller.client.spec.ts',
    'tests/listener.spec.ts', 'tests/awiki.spec.ts', 'tests/recovery-external-provider.spec.ts',
  ] : ['tests/tenant-registry.spec.ts', 'tests/tenant-switch.spec.ts']),
], { cwd: sourceRoot, env: environment, stdio: 'inherit' })
if (direct) {
  const candidate = process.env.DSH_AWIKI_CANDIDATE_TARBALL
  if (!candidate || !isAbsolute(candidate) || !statSync(candidate).isFile()) {
    throw new Error('DSH_AWIKI_CANDIDATE_TARBALL must name the local packed AWiki candidate')
  }
  const receipt = verifyAwikiDirectCandidate(sourceRoot, candidate)
  console.log(JSON.stringify({
    ...receipt,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim(),
    sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }).trim() !== '',
  }))
} else {
  execFileSync(corepack, [
    'pnpm', 'exec', 'vitest', 'run', 'tests/model-proxy.spec.ts',
  ], { cwd: proxyRoot, env: environment, stdio: 'inherit' })
}

console.log(direct
  ? 'local AWiki Direct source and packed candidate verified; production runtime pins were not updated'
  : 'local AWiki tenant registry, restart, switch, and capability binding passed')
