import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { sha256, validateManifest, verifyArchive, verifyInputs } from './prepare-runtime-inputs.mjs'

const manifest = JSON.parse(await readFile(new URL('../desktop-runtime-inputs.json', import.meta.url), 'utf8'))

test('requires the frozen self-owned package inventory and trusted archive URL', () => {
  assert.equal(validateManifest(manifest), manifest)
  for (const mutate of [
    value => { value.archive.url = 'https://example.com/inputs.tar.gz' },
    value => { value.packages[0].file = '../escape.tgz' },
    value => { value.packages[1] = value.packages[0] },
    value => { value.packages[0].sourceCommit = 'main' },
  ]) {
    const value = structuredClone(manifest)
    mutate(value)
    assert.throws(() => validateManifest(value))
  }
})

test('rejects substituted archive bytes before extraction', () => {
  const bytes = Buffer.from('frozen input')
  const frozen = { archive: { sizeBytes: bytes.length, sha256: sha256(bytes) } }
  verifyArchive(bytes, frozen)
  assert.throws(() => verifyArchive(Buffer.from('changed input'), frozen), /mismatch/u)
})

test('rejects missing, extra or modified files in the extracted runtime inventory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-input-test-'))
  const bytes = Buffer.from('package bytes')
  const frozen = { packages: [{ name: '@awiki/test', file: 'test.tgz', sha256: sha256(bytes) }] }
  try {
    await assert.rejects(verifyInputs(directory, frozen), /inventory mismatch/u)
    await writeFile(join(directory, 'test.tgz'), bytes)
    await verifyInputs(directory, frozen)
    await writeFile(join(directory, 'extra.tgz'), bytes)
    await assert.rejects(verifyInputs(directory, frozen), /inventory mismatch/u)
    await rm(join(directory, 'extra.tgz'))
    await writeFile(join(directory, 'test.tgz'), 'changed')
    await assert.rejects(verifyInputs(directory, frozen), /checksum mismatch/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
