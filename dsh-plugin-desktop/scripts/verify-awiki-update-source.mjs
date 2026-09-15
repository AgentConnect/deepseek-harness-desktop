/** Candidate evidence is isolated and explicitly separate from the pinned runtime gate. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyAwikiUpdateArchive } from './awiki-update-contract.mjs'

export function sourceDependency(manifest) {
  assert.equal(manifest.schema_version, 1)
  const dependency = manifest.dependencies?.['dsh-awiki']
  assert.equal(dependency?.repository, 'https://github.com/AgentConnect/dsh-awiki.git')
  assert.match(dependency?.commit ?? '', /^[a-f0-9]{40}$/u)
  assert.match(dependency?.pull_request ?? '', /^https:\/\/github\.com\/AgentConnect\/dsh-awiki\/pull\/[1-9][0-9]*$/u)
  return dependency
}

export async function verifyAwikiUpdateSource() {
  const dependency = sourceDependency(JSON.parse(readFileSync(new URL('../../dependencies.source.json', import.meta.url), 'utf8')))
  const temporary = mkdtempSync(join(tmpdir(), 'desktop-awiki-source-'))
  const source = join(temporary, 'source')
  const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  const run = (command, args, cwd = source) => execFileSync(command, args, { cwd, stdio: 'inherit' })
  try {
    run('git', ['init', source], temporary)
    run('git', ['fetch', '--depth=1', dependency.repository, dependency.commit])
    run('git', ['checkout', '--detach', 'FETCH_HEAD'])
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), dependency.commit)
    run(corepack, ['pnpm', 'install', '--frozen-lockfile'])
    // prepack runs the owning build, public/generated/type gates and full plugin tests.
    run(corepack, ['pnpm', 'pack', '--pack-destination', temporary])
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: source, encoding: 'utf8' }).trim(), '',
      'source build changed tracked inputs; commit regenerated files before recording candidate evidence')
    const archives = readdirSync(temporary).filter(file => file.endsWith('.tgz'))
    assert.equal(archives.length, 1)
    const archive = join(temporary, archives[0])
    const result = await verifyAwikiUpdateArchive(archive)
    console.log(JSON.stringify({ ...result, mode: 'source-candidate-only', sourceCommit: dependency.commit,
      sourceDirty: false, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
      pinnedRuntimeVerified: false }))
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyAwikiUpdateSource()
