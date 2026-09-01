import { describe, expect, it, vi } from 'vitest'
import { executeDesktopAwikiUpdate } from '../src/awiki-update-execution.ts'

const CURRENT = { pluginVersion: '0.3.2', modelProxyVersion: '0.1.2' }
const POLICY = {
  tenantId: 'official-china',
  tenantGeneration: 7,
  policyRevision: 12,
  plugin: { version: '0.3.3', integrity: `sha512-${Buffer.alloc(64).toString('base64')}` },
  modelProxy: { version: '0.1.2', integrity: `sha512-${Buffer.alloc(64).toString('base64')}` },
}

describe('settings-triggered AWiki update execution', () => {
  it('quiesces and compare-checks the Profile before starting the transaction', async () => {
    const events: string[] = []
    const result = await executeDesktopAwikiUpdate({
      expectedCurrent: CURRENT,
      expectedPolicy: POLICY,
      readPolicy: () => { events.push('policy'); return POLICY },
      quiesceHost: async () => { events.push('quiesce'); return true },
      readCurrent: async () => { events.push('read'); return CURRENT },
      upgrade: async () => {
        events.push('upgrade')
        return { status: 'upgraded', transaction: {} as never }
      },
    })

    expect(result.status).toBe('upgraded')
    expect(events).toEqual(['policy', 'quiesce', 'read', 'upgrade'])
  })

  it('does not mutate when Host quiescence fails or the preview became stale', async () => {
    const upgrade = vi.fn(async () => ({ status: 'upgraded' as const, transaction: {} as never }))
    await expect(executeDesktopAwikiUpdate({
      expectedCurrent: CURRENT,
      expectedPolicy: POLICY,
      readPolicy: () => POLICY,
      quiesceHost: async () => false,
      readCurrent: async () => CURRENT,
      upgrade,
    })).rejects.toThrow('could not be stopped safely')
    expect(upgrade).not.toHaveBeenCalled()

    await expect(executeDesktopAwikiUpdate({
      expectedCurrent: CURRENT,
      expectedPolicy: POLICY,
      readPolicy: () => POLICY,
      quiesceHost: async () => true,
      readCurrent: async () => ({ ...CURRENT, pluginVersion: '0.3.3' }),
      upgrade,
    })).rejects.toThrow('changed after the update check')
    expect(upgrade).not.toHaveBeenCalled()
  })

  it('rejects a preview after the tenant generation or policy revision changes', async () => {
    const quiesceHost = vi.fn(async () => true)
    await expect(executeDesktopAwikiUpdate({
      expectedCurrent: CURRENT,
      expectedPolicy: POLICY,
      readPolicy: () => ({ ...POLICY, tenantGeneration: POLICY.tenantGeneration + 1 }),
      quiesceHost,
      readCurrent: async () => CURRENT,
      upgrade: async () => ({ status: 'upgraded', transaction: {} as never }),
    })).rejects.toThrow('policy changed after the update check')
    expect(quiesceHost).not.toHaveBeenCalled()
  })
})
