/** Required registry/bundled-runtime gate; a candidate or source checkout cannot satisfy it. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { satisfies } from 'semver'
import { prepare } from '../../scripts/prepare-runtime-inputs.mjs'
import { verifyAwikiUpdateArchive } from './awiki-update-contract.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))
await prepare({ verifyOnly: true })
const inputs = JSON.parse(readFileSync(join(root, 'desktop-runtime-inputs.json'), 'utf8'))
const plugin = inputs.packages.find(pkg => pkg.name === '@awiki/dsh-plugin')
assert.ok(plugin, 'missing bundled AWiki input')
await verifyAwikiUpdateArchive(join(root, '.build/runtime-inputs', plugin.file))
const installed = name => JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'))
for (const name of ['@awiki/dsh-plugin', '@awiki/dsh-model-proxy', '@agent-network-protocol/dsh-anp-identity']) {
  const manifest = installed(name)
  assert.equal(manifest.version, inputs.packages.find(pkg => pkg.name === name)?.version, `${name} differs from the pinned archive`)
  for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
    let actual
    try { actual = installed(peer).version } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && manifest.peerDependenciesMeta?.[peer]?.optional === true) continue
      throw error
    }
    assert.ok(satisfies(actual, range), `${name} requires ${peer} ${range}; bundled Host has ${actual}`)
  }
}
const consumerRoot = dirname(require.resolve('@awiki/dsh-plugin/package.json'))
const { assertDesktopUpdateConsumer } = await import('./awiki-update-contract.mjs')
const { decodeDesktopDistribution } = await import(pathToFileURL(join(consumerRoot, 'lib/types/desktop-distribution.js')).href)
assertDesktopUpdateConsumer(decodeDesktopDistribution)
console.log('Pinned AWiki archive, installed consumer, and Host/Identity/Model Proxy peers accept Desktop v2')
