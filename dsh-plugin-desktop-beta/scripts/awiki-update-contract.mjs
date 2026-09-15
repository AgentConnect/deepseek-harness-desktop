/** Exercise the consumer shipped in an AWiki archive, rather than a sibling source decoder. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function assertDesktopUpdateConsumer(decode) {
  const unbound = { schemaVersion: 2, distributionId: 'awiki-dsh-desktop', currentVersion: '2.1.0-rc.8',
    channel: 'prerelease', state: 'unavailable', updateAvailable: false, usedCache: false }
  const current = decode(unbound)
  assert.ok(current, 'bundled AWiki does not accept Desktop v2: publish a compatible AWiki/Identity/DSH closure and update runtime pins before merging Desktop')
  assert.equal(current.schemaVersion, 2)
  assert.equal(current.currentVersion, unbound.currentVersion)
  assert.equal(current.state, 'unavailable')
  assert.equal(current.downloadPageUrl, undefined)
  for (const [tenantId, policyOrigin, tenantGeneration] of [['global', 'https://awiki.ai', 1], ['china', 'https://awiki.me', 2]]) {
    const ready = { ...unbound, tenantId, policyOrigin, tenantGeneration, policyRevision: 3,
      state: 'ready', updateAvailable: true, latestVersion: '2.1.0', downloadPageUrl: `${policyOrigin}/downloads/dsh-awiki/` }
    const result = decode(ready)
    assert.ok(result, 'bundled AWiki rejects a scoped Desktop recommendation')
    for (const key of Object.keys(ready)) assert.equal(result[key], ready[key], `Desktop projection lost ${key}`)
    assert.equal(decode({ ...ready, downloadPageUrl: 'https://another-tenant.example/downloads/' }), undefined,
      'bundled AWiki must reject a foreign-tenant download page')
  }
  assert.equal(decode(unbound).downloadPageUrl, undefined, 'tenant invalidation must clear the recommendation')
}

export async function verifyAwikiUpdateArchive(archive) {
  const path = resolve(archive)
  const packed = file => execFileSync('tar', ['-xOf', path, `package/${file}`], { maxBuffer: 1024 * 1024 })
  const manifest = JSON.parse(packed('package.json').toString('utf8'))
  assert.equal(manifest.name, '@awiki/dsh-plugin')
  const root = mkdtempSync(join(tmpdir(), 'desktop-update-consumer-'))
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
    // This published decoder is deliberately dependency-free. Execute its actual bytes.
    for (const file of ['desktop-distribution.js', 'version.js']) {
      writeFileSync(join(root, file), packed(`lib/types/${file}`))
    }
    const { decodeDesktopDistribution } = await import(pathToFileURL(join(root, 'desktop-distribution.js')).href)
    assertDesktopUpdateConsumer(decodeDesktopDistribution)
    return { package: manifest.name, version: manifest.version, contract: 'desktop-v2',
      peerDependencies: manifest.peerDependencies }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
