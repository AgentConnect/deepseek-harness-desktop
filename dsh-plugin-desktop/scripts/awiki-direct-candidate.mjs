/** Verify a local candidate against the actual source build without changing release pins. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function verifyAwikiDirectCandidate(sourceRoot, candidate) {
  const source = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'))
  const packed = file => execFileSync('tar', ['-xOf', candidate, `package/${file}`], { maxBuffer: 8 * 1024 * 1024 })
  const manifest = JSON.parse(packed('package.json').toString('utf8'))
  if (manifest.name !== '@awiki/dsh-plugin' || manifest.version !== source.version
    || JSON.stringify(manifest.dependencies) !== JSON.stringify(source.dependencies)
    || JSON.stringify(manifest.peerDependencies) !== JSON.stringify(source.peerDependencies)) {
    throw new Error('AWiki candidate manifest does not match the verified source')
  }
  // Include shared SDK chunks: the Provider entry alone does not contain the send implementation.
  const bundles = readdirSync(join(sourceRoot, 'lib')).filter(file => /\.m?js$/u.test(file)).sort()
  const packedBundles = execFileSync('tar', ['-tzf', candidate], { encoding: 'utf8' })
    .split('\n').filter(file => /^package\/lib\/[^/]+\.m?js$/u.test(file))
    .map(file => file.slice('package/lib/'.length)).sort()
  if (JSON.stringify(bundles) !== JSON.stringify(packedBundles)) {
    throw new Error('AWiki candidate runtime bundles do not match the verified source')
  }
  for (const bundle of bundles) {
    const file = `lib/${bundle}`
    if (!packed(file).equals(readFileSync(join(sourceRoot, file)))) throw new Error(`stale AWiki candidate: ${file}`)
  }
  return {
    mode: 'local-candidate-only', package: manifest.name, version: manifest.version,
    sha256: createHash('sha256').update(readFileSync(candidate)).digest('hex'),
  }
}
