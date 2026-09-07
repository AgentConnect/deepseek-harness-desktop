/** Materialize the exact Desktop-owned runtime archive before Yarn installation. */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/u.test(manifest.archive?.sha256 ?? '')
    || !Number.isSafeInteger(manifest.archive?.sizeBytes) || manifest.archive.sizeBytes <= 0
    || !Array.isArray(manifest.packages) || manifest.packages.length !== 9) {
    throw new Error('invalid Desktop runtime input manifest')
  }
  const url = new URL(manifest.archive.url)
  if (url.origin !== 'https://github.com'
    || !url.pathname.startsWith('/AgentConnect/deepseek-harness-desktop/releases/download/desktop-build-inputs-')
    || url.search || url.hash || url.username || url.password) throw new Error('untrusted runtime archive URL')
  const names = new Set()
  const files = new Set()
  for (const pkg of manifest.packages) {
    if (!/^(?:@awiki|@agent-network-protocol)\/[a-z0-9-]+$/u.test(pkg.name)
      || !/^\d+\.\d+\.\d+$/u.test(pkg.version)
      || !/^[a-z0-9.-]+\.tgz$/u.test(pkg.file) || basename(pkg.file) !== pkg.file
      || !/^[a-f0-9]{64}$/u.test(pkg.sha256) || !/^[a-f0-9]{40}$/u.test(pkg.sourceCommit)
      || names.has(pkg.name) || files.has(pkg.file)) throw new Error('invalid or duplicate runtime package')
    names.add(pkg.name)
    files.add(pkg.file)
  }
  return manifest
}

export async function verifyInputs(directory, manifest) {
  const actual = (await readdir(directory)).sort()
  const expected = manifest.packages.map(pkg => pkg.file).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('runtime input inventory mismatch')
  for (const pkg of manifest.packages) {
    const path = join(directory, pkg.file)
    if (!(await lstat(path)).isFile() || sha256(await readFile(path)) !== pkg.sha256) {
      throw new Error(`runtime input checksum mismatch: ${pkg.name}`)
    }
  }
}

export function verifyArchive(bytes, manifest) {
  if (bytes.length !== manifest.archive.sizeBytes || sha256(bytes) !== manifest.archive.sha256) {
    throw new Error('runtime archive checksum or size mismatch')
  }
}

export async function prepare({ verifyOnly = false } = {}) {
  const manifest = validateManifest(JSON.parse(await readFile(join(root, 'desktop-runtime-inputs.json'), 'utf8')))
  const destination = join(root, '.build', 'runtime-inputs')
  try {
    await verifyInputs(destination, manifest)
    console.log('Desktop runtime inputs: all 9 package checksums verified')
    return
  } catch (error) {
    if (verifyOnly) throw error
    // Corrupt cached inputs fail closed; do not silently replace them during review.
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(dirname(destination), { recursive: true })
  const temporary = await mkdtemp(join(dirname(destination), 'runtime-download-'))
  try {
    const response = await fetch(manifest.archive.url, { signal: AbortSignal.timeout(180_000) })
    if (!response.ok) throw new Error(`runtime archive download returned HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    verifyArchive(bytes, manifest)
    const archive = join(temporary, 'inputs.tar.gz')
    const extracted = join(temporary, 'extracted')
    await writeFile(archive, bytes)
    await mkdir(extracted)
    // Only the SHA-pinned, project-owned archive reaches the platform tar utility.
    const result = spawnSync('tar', ['-xzf', archive, '-C', extracted], { stdio: 'inherit', shell: false })
    if (result.error || result.status !== 0) throw new Error('runtime archive extraction failed', { cause: result.error })
    await verifyInputs(extracted, manifest)
    await rename(extracted, destination)
    console.log('Desktop runtime inputs: downloaded and verified all 9 packages')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepare({ verifyOnly: process.argv.includes('--verify-only') })
}
