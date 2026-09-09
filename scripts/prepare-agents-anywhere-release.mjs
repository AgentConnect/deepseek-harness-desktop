import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRepository = process.env.DSH_AA_SOURCE_REPOSITORY ?? 'https://github.com/anywhere-labs/Agents-Anywhere.git'
const sourceRef = process.env.DSH_AA_SOURCE_REF ?? 'v2'
const vendorRoot = resolve(root, 'vendor/agents-anywhere')
const provenancePath = join(vendorRoot, 'provenance.json')
const currentProvenance = existsSync(provenancePath) ? JSON.parse(readFileSync(provenancePath, 'utf8')) : {}
const desktopVersion = process.env.DSH_AA_DESKTOP_VERSION ?? currentProvenance.desktopVersion ?? '0.1.0-dev.0.desktop.3'
const artifactName = process.env.DSH_AA_ARTIFACT ?? currentProvenance.artifact ?? `agents-anywhere-dsh-bridge-next-${desktopVersion}.tgz`
const peerPackages = ['@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session']

function command(name) {
  return process.platform === 'win32' && (name === 'corepack' || name === 'npm') ? `${name}.cmd` : name
}

function run(name, args, cwd) {
  const result = spawnSync(command(name), args, { cwd, env: process.env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${name} ${args.join(' ')} exited with ${String(result.status)}`)
}

function capture(name, args, cwd) {
  return execFileSync(command(name), args, { cwd, encoding: 'utf8' }).trim()
}

function copySourceTree(source, destination) {
  const ignored = new Set(['.git', '.yarn', 'node_modules', 'lib', 'coverage', '.venv', '__pycache__', '.pytest_cache', '.ruff_cache'])
  cpSync(source, destination, {
    recursive: true,
    filter: current => {
      const parts = relative(source, current).split(sep)
      const name = basename(current)
      return !parts.some(part => ignored.has(part)) && !name.endsWith('.pyc') && !name.endsWith('.tsbuildinfo')
    },
  })
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function runtimePeerRanges() {
  const values = new Map(peerPackages.map(name => [name, new Set()]))
  for (const packagePath of ['dsh-plugin-desktop/package.json', 'dsh-plugin-desktop-beta/package.json']) {
    const manifest = readJson(resolve(root, packagePath))
    for (const name of peerPackages) {
      const range = manifest.dependencies?.[name]
      if (typeof range !== 'string' || range.length === 0) throw new Error(`Missing ${name} in ${packagePath}`)
      values.get(name).add(range)
    }
  }
  return Object.fromEntries([...values].map(([name, ranges]) => [name, [...ranges].join(' || ')]))
}

function patchManifest(packagePath, peerRanges) {
  const manifest = readJson(join(packagePath, 'package.json'))
  const sourceVersion = manifest.version
  manifest.version = desktopVersion
  manifest.peerDependencies = { ...manifest.peerDependencies, ...peerRanges }
  writeFileSync(join(packagePath, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { sourceVersion }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function cloneSource(stagingRoot) {
  const checkout = join(stagingRoot, 'source')
  if (/^[0-9a-f]{40}$/iu.test(sourceRef)) {
    run('git', ['clone', '--filter=blob:none', '--no-checkout', '--no-tags', sourceRepository, checkout], stagingRoot)
    run('git', ['fetch', '--depth=1', 'origin', sourceRef], checkout)
    run('git', ['checkout', '--detach', 'FETCH_HEAD'], checkout)
  } else {
    run('git', ['clone', '--depth=1', '--no-tags', '--branch', sourceRef, sourceRepository, checkout], stagingRoot)
  }
  return { checkout, commit: capture('git', ['rev-parse', 'HEAD'], checkout) }
}

function validateInputs() {
  if (!/^[0-9A-Za-z.+-]+$/u.test(desktopVersion)) throw new Error(`Invalid DSH_AA_DESKTOP_VERSION: ${desktopVersion}`)
  if (basename(artifactName) !== artifactName || !artifactName.endsWith('.tgz')) throw new Error(`Invalid DSH_AA_ARTIFACT: ${artifactName}`)
}

function prepare() {
  validateInputs()
  mkdirSync(vendorRoot, { recursive: true })
  const stagingRoot = mkdtempSync(join(tmpdir(), 'dsh-agents-anywhere-release-'))
  try {
    const { checkout, commit } = cloneSource(stagingRoot)
    const buildRoot = join(stagingRoot, 'build')
    const packageRoot = join(buildRoot, 'dsh-bridge-next')
    const packRoot = join(stagingRoot, 'pack')
    mkdirSync(buildRoot)
    mkdirSync(packRoot)
    copySourceTree(join(checkout, 'dsh-bridge-next'), packageRoot)
    copySourceTree(join(checkout, 'connector'), join(buildRoot, 'connector'))

    const peerRanges = runtimePeerRanges()
    const { sourceVersion } = patchManifest(packageRoot, peerRanges)
    run('corepack', ['yarn', 'install', '--mode=skip-builds'], packageRoot)
    run('corepack', ['yarn', 'build'], packageRoot)
    run('npm', ['pack', '--ignore-scripts', '--pack-destination', packRoot], packageRoot)

    const packed = readdirSync(packRoot).filter(name => name.endsWith('.tgz'))
    if (packed.length !== 1) throw new Error(`Expected one AA package, found ${packed.length}`)
    const targetArtifact = join(vendorRoot, artifactName)
    cpSync(join(packRoot, packed[0]), targetArtifact)
    const provenance = {
      repository: sourceRepository,
      branch: /^[0-9a-f]{40}$/iu.test(sourceRef) ? (process.env.DSH_AA_SOURCE_BRANCH ?? 'v2') : sourceRef,
      commit,
      packageDirectory: 'dsh-bridge-next',
      sourceVersion,
      desktopVersion,
      artifact: artifactName,
      sha256: sha256(targetArtifact),
      manifestChanges: [
        `version set to ${desktopVersion}`,
        ...peerPackages.map(name => `${name} peer accepts ${peerRanges[name]}`),
      ],
      sourceChanges: [],
    }
    writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`)
    run('corepack', ['yarn', 'install', '--mode=skip-builds'], root)
    console.log(`Agents Anywhere release package prepared from ${commit} (${targetArtifact})`)
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    prepare()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

export { patchManifest, runtimePeerRanges }
