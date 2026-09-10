import { describe, expect, it, vi } from 'vitest'
import { executeDesktopAwikiUpdate } from '../src/awiki-update-execution.ts'

const CURRENT = { pluginVersion: '0.3.2', modelProxyVersion: '0.1.2' }

describe('settings-triggered AWiki update execution', () => {
  it('quiesces and compare-checks the Profile before starting the transaction', async () => {
    const events: string[] = []
    const result = await executeDesktopAwikiUpdate({
      expectedCurrent: CURRENT,
      quiesceHost: async () => { events.push('quiesce'); return true },
      readCurrent: async () => { events.push('read'); return CURRENT },
      upgrade: async () => {
        events.push('upgrade')
        return { status: 'upgraded', transaction: {} as never }
      },
    })

    expect(result.status).toBe('upgraded')
    expect(events).toEqual(['quiesce', 'read', 'upgrade'])
  })

  it('does not mutate when Host quiescence fails or the preview became stale', async () => {
    const upgrade = vi.fn(async () => ({ status: 'upgraded' as const, transaction: {} as never }))
    await expect(executeDesktopAwikiUpdate({
      expectedCurrent: CURRENT,
      quiesceHost: async () => false,
      readCurrent: async () => CURRENT,
      upgrade,
    })).rejects.toThrow('could not be stopped safely')
    expect(upgrade).not.toHaveBeenCalled()

    await expect(executeDesktopAwikiUpdate({
      expectedCurrent: CURRENT,
      quiesceHost: async () => true,
      readCurrent: async () => ({ ...CURRENT, pluginVersion: '0.3.3' }),
      upgrade,
    })).rejects.toThrow('changed after the update check')
    expect(upgrade).not.toHaveBeenCalled()
  })
})
