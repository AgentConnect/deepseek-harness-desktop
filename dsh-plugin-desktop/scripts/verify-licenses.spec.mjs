import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scripts = dirname(fileURLToPath(import.meta.url))
const name = '@agentconnect/dsh-pap'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-private-license-'))
  const desktop = join(root, 'dsh-plugin-desktop')
  const relative = 'vendor/identity-candidate/current/agentconnect-dsh-pap.tgz'
  const archive = join(root, relative)
  const metadataPath = join(dirname(archive), 'candidate.json')
  const manifest = { name, version: '0.1.0', private: true, license: 'UNLICENSED' }
  const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)) }
  write(join(root, 'package.json'), { private: true, resolutions: { [name]: 'file:' + relative } })
  write(join(root, 'upstream.json'), { sourceCandidate: { private: true, registryPublished: false } })
  write(join(desktop, 'package.json'), { name: 'dsh-plugin-desktop', dependencies: { [name]: '0.1.0' } })
  write(join(root, 'node_modules', name, 'package.json'), manifest)
  mkdirSync(dirname(archive), { recursive: true })
  // This contract tests byte provenance; Yarn separately owns archive installation.
  writeFileSync(archive, 'private candidate archive fixture')
  const archiveBytes = readFileSync(archive)
  const metadata = { kind: 'private-local-candidate', registryPublished: false, artifacts: [
    { package: name, path: relative, sha256: createHash('sha256').update(archiveBytes).digest('hex'), bytes: archiveBytes.length },
  ] }
  write(metadataPath, metadata)
  mkdirSync(join(desktop, 'scripts'), { recursive: true })
  for (const file of ['verify-licenses.mjs', 'private-candidate-license.mjs']) {
    if (existsSync(join(scripts, file))) copyFileSync(join(scripts, file), join(desktop, 'scripts', file))
  }
  return { root, desktop, manifest, metadata, archive, metadataPath, write,
    run: (...args) => spawnSync(process.execPath, [join(desktop, 'scripts/verify-licenses.mjs'), ...args], { encoding: 'utf8' }),
    dispose() { rmSync(root, { recursive: true, force: true }) },
  }
}

test('accepts only the hash-bound private first-party candidate and labels it private-only', context => {
  const f = fixture()
  context.after(() => f.dispose())
  const result = f.run('--notices', 'notices.md')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /private-only/u)
  assert.match(result.stdout, /not cleared for redistribution/u)
  assert.doesNotMatch(result.stdout, /redistribution-safe/u)
  const notices = readFileSync(join(f.desktop, 'notices.md'), 'utf8')
  assert.match(notices, /Private local candidates/u)
  assert.match(notices, /UNLICENSED/u)
  assert.match(notices, new RegExp(f.metadata.artifacts[0].sha256, 'u'))
})

test('keeps unknown private or third-party UNLICENSED dependencies rejected', context => {
  const f = fixture()
  context.after(() => f.dispose())
  const other = '@third-party/private-plugin'
  f.write(join(f.desktop, 'package.json'), { name: 'dsh-plugin-desktop', dependencies: { [name]: '0.1.0', [other]: '1.0.0' } })
  f.write(join(f.root, 'node_modules', other, 'package.json'), { name: other, version: '1.0.0', private: true, license: 'UNLICENSED' })
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /@third-party\/private-plugin: license "UNLICENSED"/u)
  assert.doesNotMatch(result.stderr, /@agentconnect\/dsh-pap: license/u)
})

test('requires the exact first-party package name and boolean private manifest', context => {
  for (const changed of [{ private: false }, { private: 'true' }, { name: '@other/dsh-pap' }]) {
    const f = fixture()
    context.after(() => f.dispose())
    f.write(join(f.root, 'node_modules', name, 'package.json'), { ...f.manifest, ...changed })
    const result = f.run()
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /license "UNLICENSED" is not on/u)
  }
})

test('requires both existing metadata documents to authorize a private unpublished candidate', context => {
  for (const changed of ['upstream-private', 'upstream-published', 'candidate-published', 'missing-candidate']) {
    const f = fixture()
    context.after(() => f.dispose())
    if (changed === 'upstream-private') f.write(join(f.root, 'upstream.json'), { sourceCandidate: { private: false, registryPublished: false } })
    if (changed === 'upstream-published') f.write(join(f.root, 'upstream.json'), { sourceCandidate: { private: true, registryPublished: true } })
    if (changed === 'candidate-published') f.write(f.metadataPath, { ...f.metadata, registryPublished: true })
    if (changed === 'missing-candidate') rmSync(f.metadataPath)
    const result = f.run()
    assert.notEqual(result.status, 0, changed)
    assert.match(result.stderr, /license "UNLICENSED" is not on/u)
  }
})

test('binds a unique candidate artifact to the canonical Yarn file pin, existing bytes and SHA', context => {
  for (const changed of ['missing-archive', 'sha', 'bytes', 'duplicate', 'file-pin', 'path-escape']) {
    const f = fixture()
    context.after(() => f.dispose())
    const entry = f.metadata.artifacts[0]
    if (changed === 'missing-archive') rmSync(f.archive)
    if (changed === 'sha') entry.sha256 = '0'.repeat(64)
    if (changed === 'bytes') entry.bytes += 1
    if (changed === 'duplicate') f.metadata.artifacts.push({ ...entry })
    if (changed === 'file-pin') {
      const other = 'vendor/identity-candidate/current/other.tgz'
      copyFileSync(f.archive, join(f.root, other))
      f.write(join(f.root, 'package.json'), { resolutions: { [name]: 'file:' + other } })
    }
    if (changed === 'path-escape') f.write(join(f.root, 'package.json'), {
      resolutions: { [name]: 'file:vendor/identity-candidate/current/../other.tgz' },
    })
    f.write(f.metadataPath, f.metadata)
    const result = f.run()
    assert.notEqual(result.status, 0, changed)
    assert.match(result.stderr, /license "UNLICENSED" is not on/u)
  }
})

test('retains the ordinary permissive-license path without private metadata', context => {
  const f = fixture()
  context.after(() => f.dispose())
  f.write(join(f.desktop, 'package.json'), { name: 'dsh-plugin-desktop', dependencies: { 'public-package': '1.0.0' } })
  f.write(join(f.root, 'node_modules/public-package/package.json'), { name: 'public-package', version: '1.0.0', license: 'MIT' })
  rmSync(join(f.root, 'upstream.json'))
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /1 production packages carry redistribution-safe licenses/u)
  assert.doesNotMatch(result.stdout, /private-only/u)
})
