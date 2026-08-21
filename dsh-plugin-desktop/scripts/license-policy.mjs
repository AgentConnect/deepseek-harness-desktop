/** Project-specific commercial-license policy for exact AGPL package releases. */

/** Validate a machine-readable commercial grant before accepting it in release checks. */
export function validateCommercialGrant(grant, licenseDocumentText) {
  if (grant?.schemaVersion !== 1
    || typeof grant.grantId !== 'string' || grant.grantId.length === 0
    || grant.licensor !== 'Hangzhou Vector Consensus Technology Co., Ltd.'
    || grant.coveredRepository !== 'https://github.com/AgentConnect/deepseek-harness-desktop'
    || grant.licenseDocument !== 'AWIKI-COMMERCIAL-LICENSE.md'
    || typeof grant.packages !== 'object' || grant.packages === null || Array.isArray(grant.packages)) {
    throw new Error('invalid AWiki commercial license grant metadata')
  }
  if (!licenseDocumentText.includes(`Grant ID: \`${grant.grantId}\``)
    || !licenseDocumentText.includes(`Licensor: ${grant.licensor}`)
    || !licenseDocumentText.includes('Covered project: `AgentConnect/deepseek-harness-desktop`')) {
    throw new Error('AWiki commercial license document does not match its grant metadata')
  }
  for (const [name, version] of Object.entries(grant.packages)) {
    if (typeof version !== 'string' || version.length === 0
      || !licenseDocumentText.includes(`\`${name}@${version}\``)) {
      throw new Error(`AWiki commercial license document does not cover ${name}@${String(version)}`)
    }
  }
  return grant
}

/** Return an auditable display license only for one exact package version. */
export function commercialLicenseForPackage(grant, name, version, upstreamLicense) {
  if (upstreamLicense !== 'AGPL-3.0-only' || grant.packages[name] !== version) return undefined
  return `AWiki Commercial License (${grant.grantId}; upstream ${upstreamLicense})`
}
