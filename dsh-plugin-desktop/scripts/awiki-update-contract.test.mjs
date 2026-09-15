import assert from 'node:assert/strict'
import test from 'node:test'
import { assertDesktopUpdateConsumer, verifyAwikiUpdateArchive } from './awiki-update-contract.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sourceDependency } from './verify-awiki-update-source.mjs'

test('source verification requires an exact public commit and matching PR provenance', () => {
  const source = { repository: 'https://github.com/AgentConnect/dsh-awiki.git', commit: 'a'.repeat(40),
    pull_request: 'https://github.com/AgentConnect/dsh-awiki/pull/62' }
  const wrap = value => ({ schema_version: 1, dependencies: { 'dsh-awiki': value } })
  assert.deepEqual(sourceDependency(wrap(source)), source)
  for (const invalid of [{ ...source, commit: 'release/0815-bugfix' },
    { ...source, repository: 'file:///tmp/source' }, { ...source, pull_request: 'https://example.com/62' }]) {
    assert.throws(() => sourceDependency(wrap(invalid)))
  }
})

test('rejects legacy, lossy and cross-tenant consumers', () => {
  assert.throws(() => assertDesktopUpdateConsumer(() => undefined), /does not accept Desktop v2/)
  assert.throws(() => assertDesktopUpdateConsumer(value => ({ ...value, tenantGeneration: undefined })), /tenantGeneration/)
  assert.throws(() => assertDesktopUpdateConsumer(value => value), /foreign-tenant/)
  assertDesktopUpdateConsumer(value => value.downloadPageUrl && !value.downloadPageUrl.startsWith(value.policyOrigin + '/')
    ? undefined : { ...value })
})

test('the exact pre-review 0.3.10 archive reproduces the v2 incompatibility', async () => {
  const inputs = JSON.parse(readFileSync(new URL('../../desktop-runtime-inputs.json', import.meta.url), 'utf8'))
  const plugin = inputs.packages.find(pkg => pkg.name === '@awiki/dsh-plugin')
  const archive = fileURLToPath(new URL(`../../.build/runtime-inputs/${plugin.file}`, import.meta.url))
  if (plugin.version === '0.3.10') {
    await assert.rejects(verifyAwikiUpdateArchive(archive), /does not accept Desktop v2/)
  } else {
    // A future pin must prove the contract instead of silently removing this regression.
    assert.equal((await verifyAwikiUpdateArchive(archive)).contract, 'desktop-v2')
  }
})
