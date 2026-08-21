import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  commercialLicenseForPackage,
  validateCommercialGrant,
} from '../scripts/license-policy.mjs'

const packageRoot = new URL('../', import.meta.url)
const grant = JSON.parse(readFileSync(new URL('awiki-commercial-license.json', packageRoot), 'utf8'))
const document = readFileSync(new URL('AWIKI-COMMERCIAL-LICENSE.md', packageRoot), 'utf8')

describe('AWiki commercial license policy', () => {
  it('accepts every exact package version named by the matching written grant', () => {
    const validated = validateCommercialGrant(grant, document)
    for (const [name, version] of Object.entries(validated.packages)) {
      expect(commercialLicenseForPackage(validated, name, version, 'AGPL-3.0-only'))
        .toContain(validated.grantId)
    }
  })

  it('does not silently cover a later version, another package, or another upstream license', () => {
    const validated = validateCommercialGrant(grant, document)
    expect(commercialLicenseForPackage(validated, '@awiki/im-core-node', '0.1.7', 'AGPL-3.0-only'))
      .toBeUndefined()
    expect(commercialLicenseForPackage(validated, '@awiki/other', '0.1.6', 'AGPL-3.0-only'))
      .toBeUndefined()
    expect(commercialLicenseForPackage(validated, '@awiki/im-core-node', '0.1.6', 'MIT'))
      .toBeUndefined()
  })

  it('rejects grant metadata that does not match the written package scope', () => {
    expect(() => validateCommercialGrant({
      ...grant,
      packages: { ...grant.packages, '@awiki/im-core-node': '0.1.7' },
    }, document)).toThrow('does not cover @awiki/im-core-node@0.1.7')
  })
})
