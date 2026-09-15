import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyAwikiDirectCandidate, candidateBundleNames } from './awiki-direct-candidate.mjs'

test('accepts matching candidate bytes and rejects stale code or substituted runtime dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-direct-candidate-'))
  const source = join(root, 'package')
  const tarball = join(root, 'candidate.tgz')
  const manifest = { name: '@awiki/dsh-plugin', version: '0.3.11-rc.1', dependencies: { '@awiki/im-core-node': '0.2.6' } }
  try {
    mkdirSync(join(source, 'lib'), { recursive: true })
    writeFileSync(join(source, 'package.json'), JSON.stringify(manifest))
    for (const name of ['index', 'provider', 'client', 'typert.remote-client']) {
      writeFileSync(join(source, 'lib', `${name}.js`), `export const candidate = '${name}'`)
    }
    writeFileSync(join(source, 'lib', 'sdk-adapter-fixture.mjs'), 'export const adapter = 1')
    execFileSync('tar', ['-czf', tarball, '-C', root, 'package'])
    assert.match(verifyAwikiDirectCandidate(source, tarball).sha256, /^[a-f0-9]{64}$/u)
    writeFileSync(join(source, 'lib', 'sdk-adapter-fixture.mjs'), 'export const adapter = 2')
    assert.throws(() => verifyAwikiDirectCandidate(source, tarball), /stale AWiki candidate: lib\/sdk-adapter-fixture.mjs/u)
    writeFileSync(join(source, 'lib', 'sdk-adapter-fixture.mjs'), 'export const adapter = 1')
    writeFileSync(join(source, 'lib', 'extra.mjs'), 'export const unexpected = true')
    assert.throws(() => verifyAwikiDirectCandidate(source, tarball), /runtime bundles do not match/u)
    rmSync(join(source, 'lib', 'extra.mjs'))
    writeFileSync(join(source, 'lib', 'provider.js'), 'newer provider')
    assert.throws(() => verifyAwikiDirectCandidate(source, tarball), /stale AWiki candidate: lib\/provider.js/u)
    writeFileSync(join(source, 'package.json'), JSON.stringify({ ...manifest, dependencies: { '@awiki/im-core-node': '0.2.4' } }))
    assert.throws(() => verifyAwikiDirectCandidate(source, tarball), /manifest does not match/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('compares identical runtime bundle inventories from Windows and POSIX tar output', () => {
  const entries = ['package/', 'package/lib/index.js', 'package/lib/sdk-adapter-real.mjs',
    'package/lib/client.js', 'package/lib/types/index.js', 'package/lib/client.js.map', '']
  const expected = ['client.js', 'index.js', 'sdk-adapter-real.mjs']
  assert.deepEqual(candidateBundleNames(entries.join('\r\n')), expected)
  assert.deepEqual(candidateBundleNames(entries.join('\n')), expected)
})
