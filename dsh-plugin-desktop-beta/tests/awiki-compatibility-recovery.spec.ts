import { describe, expect, it, vi } from 'vitest'
import { requestAwikiCompatibilityRecovery } from '../src/awiki-compatibility-recovery.ts'

const fallback = {
  source: 'install' as const,
  pluginVersion: '0.3.16', modelProxyVersion: '0.1.11',
  rejectedPluginVersion: '0.3.2', rejectedModelProxyVersion: '0.1.2',
}

describe('AWiki local compatibility recovery', () => {
  it.each(['en', 'zh'] as const)('offers the bundled pair in a Profile-scoped terminal (%s)', async locale => {
    const showMessageBox = vi.fn(async () => ({ response: 0 }))
    const logger = { error: vi.fn() }
    await expect(requestAwikiCompatibilityRecovery(fallback, locale, logger, showMessageBox)).resolves.toBe('terminal')
    expect(showMessageBox).toHaveBeenCalledOnce()
    expect(showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning', defaultId: 0, cancelId: 1, noLink: true,
      detail: expect.stringContaining('dsh plugin add @awiki/dsh-plugin@0.3.16 @awiki/dsh-model-proxy@0.1.11'),
    }))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it.each([1, -1])('exits on cancellation without selecting terminal (%s)', async response => {
    await expect(requestAwikiCompatibilityRecovery(fallback, 'en', { error: vi.fn() },
      async () => ({ response }))).resolves.toBe('exit')
  })

  it('exits and records a dialog failure without starting an upgrade or retry loop', async () => {
    const logger = { error: vi.fn() }
    const dialog = vi.fn(async () => { throw new Error('dialog unavailable') })
    await expect(requestAwikiCompatibilityRecovery(fallback, 'en', logger, dialog)).resolves.toBe('exit')
    expect(dialog).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('dialog unavailable'))
  })
})
