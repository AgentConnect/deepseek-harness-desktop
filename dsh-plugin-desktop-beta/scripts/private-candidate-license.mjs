/** One first-party private candidate exception, bound to the existing Yarn file pin and vendor checksum. */
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

const PAP = '@agentconnect/dsh-pap'
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

export function privateCandidateLicense(name, manifest, repositoryRoot) {
  if (name !== PAP || manifest.name !== PAP || manifest.private !== true || manifest.license !== 'UNLICENSED') return undefined
  try {
    const root = realpathSync(repositoryRoot)
    const source = readJson(join(root, 'upstream.json')).sourceCandidate
    if (source?.private !== true || source.registryPublished !== false) return undefined
    const locator = readJson(join(root, 'package.json')).resolutions?.[PAP]
    if (typeof locator !== 'string' || !/^file:vendor\/identity-candidate\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u.test(locator)) return undefined
    const path = locator.slice('file:'.length)
    const archive = join(root, path)
    if (!lstatSync(archive).isFile() || realpathSync(archive) !== archive) return undefined
    const metadataPath = join(dirname(archive), 'candidate.json')
    if (!lstatSync(metadataPath).isFile() || realpathSync(metadataPath) !== metadataPath) return undefined
    const metadata = readJson(metadataPath)
    if (metadata.kind !== 'private-local-candidate' || metadata.registryPublished !== false || !Array.isArray(metadata.artifacts)) return undefined
    const entries = metadata.artifacts.filter(entry => entry?.package === PAP)
    if (entries.length !== 1) return undefined
    const artifact = entries[0]
    if (artifact.path !== path || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0
      || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) return undefined
    const bytes = readFileSync(archive)
    if (bytes.length !== artifact.bytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) return undefined
    return { path, sha256: artifact.sha256 }
  } catch { return undefined }
}
