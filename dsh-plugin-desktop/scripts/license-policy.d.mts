export interface CommercialLicenseGrant {
  readonly schemaVersion: 1
  readonly grantId: string
  readonly effectiveDate: string
  readonly licensor: string
  readonly coveredRepository: string
  readonly licenseDocument: string
  readonly packages: Readonly<Record<string, string>>
}

export function validateCommercialGrant(
  grant: unknown,
  licenseDocumentText: string,
): CommercialLicenseGrant

export function commercialLicenseForPackage(
  grant: CommercialLicenseGrant,
  name: string,
  version: unknown,
  upstreamLicense: unknown,
): string | undefined
