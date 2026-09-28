import assert from 'node:assert/strict'
import test from 'node:test'
import { assertDesktopUpdateConsumer } from './awiki-update-contract.mjs'
import { decodeDesktopDistribution as legacyDecode } from '../tests/fixtures/awiki-0.3.10/desktop-distribution.js'

test('rejects legacy, lossy and cross-tenant consumers', () => {
  assert.throws(() => assertDesktopUpdateConsumer(() => undefined), /does not accept Desktop v2/)
  assert.throws(() => assertDesktopUpdateConsumer(value => ({ ...value, tenantGeneration: undefined })), /tenantGeneration/)
  assert.throws(() => assertDesktopUpdateConsumer(value => value), /foreign-tenant/)
  assertDesktopUpdateConsumer(value => value.downloadPageUrl && !value.downloadPageUrl.startsWith(value.policyOrigin + '/')
    ? undefined : { ...value })
})

test('the published 0.3.10 decoder reproduces the v2 incompatibility', () => {
  assert.throws(() => assertDesktopUpdateConsumer(legacyDecode), /does not accept Desktop v2/)
})
