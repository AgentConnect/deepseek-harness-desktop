/** Verify the installed npm consumer and the actual bundled Host dependency closure. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { satisfies } from 'semver'
import { assertDesktopUpdateConsumer } from './awiki-update-contract.mjs'
const require = createRequire(new URL('../package.json', import.meta.url))
const desktop = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const installed = name => JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'))
for (const name of ['@awiki/dsh-plugin', '@awiki/dsh-model-proxy', '@agent-network-protocol/dsh-anp-identity']) {
  const manifest = installed(name)
  assert.equal(manifest.version, desktop.dependencies[name], `${name} differs from the exact Desktop pin`)
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
const { decodeDesktopDistribution } = await import(pathToFileURL(join(consumerRoot, 'lib/types/desktop-distribution.js')).href)
assertDesktopUpdateConsumer(decodeDesktopDistribution)
console.log('Installed AWiki accepts Desktop v2 and all bundled Host/Identity/Model Proxy peers match')
