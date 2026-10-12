/** Verify the installed test candidates byte-for-byte before product packaging. */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'singapore-test-packages.json'), 'utf8'))
if (manifest.batch !== 'singapore-release-20261012' || manifest.packages.length !== 15) throw new Error('Incomplete test source manifest')
for (const variant of ['dsh-plugin-desktop', 'dsh-plugin-desktop-beta']) {
  const require = createRequire(join(root, variant, 'package.json'))
  for (const entry of manifest.packages) {
    if (entry.os && !entry.os.includes(process.platform)) continue
    if (entry.cpu && process.platform !== 'darwin' && !entry.cpu.includes(process.arch)) continue
    const folder = require.resolve.paths(entry.name)
      .map(base => join(base, entry.name))
      .find(base => existsSync(join(base, 'package.json')))
    if (folder === undefined) throw new Error(`Package root missing: ${entry.name}`)
    const actual = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))
    if (actual.name !== entry.name || actual.version !== entry.version) throw new Error(`Wrong test package: ${entry.name}`)
    for (const [path, expected] of Object.entries(entry.runtimeFiles)) {
      const hash = createHash('sha256').update(readFileSync(join(folder, path))).digest('hex')
      if (hash !== expected) throw new Error(`${variant}: ${entry.name}/${path} differs from audited CI artifact`)
    }
  }
  const requirePlugin = require.resolve('@awiki/dsh-plugin/package.json')
  const tenants = JSON.parse(readFileSync(join(dirname(requirePlugin), 'lib/builtin-tenants.json'), 'utf8'))
  if (tenants.tenants[tenants.default_slot].backend_origin !== 'https://anpclaw.com') throw new Error('Wrong default tenant')
  console.log(`${variant}: candidate runtime files match audited CI artifacts; default tenant is Singapore`)
}
