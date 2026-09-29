import { describe, expect, it, vi } from 'vitest'
import { recoverAwikiCompatibility, requestAwikiCompatibilityRecovery } from '../src/awiki-compatibility-recovery.ts'

const fallback = {
  source: 'install' as const,
  pluginVersion: '0.3.17', modelProxyVersion: '0.1.11',
  rejectedPluginVersion: '0.3.2', rejectedModelProxyVersion: '0.1.2',
}

describe('AWiki local compatibility recovery', () => {
  it.each(['en', 'zh'] as const)('offers the bundled pair in a Profile-scoped terminal (%s)', async locale => {
    const showMessageBox = vi.fn(async () => ({ response: 0 }))
    const logger = { error: vi.fn() }
    await expect(requestAwikiCompatibilityRecovery(fallback, locale, logger, showMessageBox, 'darwin')).resolves.toBe('terminal')
    expect(showMessageBox).toHaveBeenCalledOnce()
    expect(showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning', defaultId: 0, cancelId: 1, noLink: true,
      detail: expect.stringContaining('dsh plugin add @awiki/dsh-plugin@0.3.17 @awiki/dsh-model-proxy@0.1.11'),
    }))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it.each([1, -1])('exits on cancellation without selecting terminal (%s)', async response => {
    await expect(requestAwikiCompatibilityRecovery(fallback, 'en', { error: vi.fn() },
      async () => ({ response }), 'darwin')).resolves.toBe('exit')
  })

  it('exits and records a dialog failure without starting an upgrade or retry loop', async () => {
    const logger = { error: vi.fn() }
    const dialog = vi.fn(async () => { throw new Error('dialog unavailable') })
    await expect(requestAwikiCompatibilityRecovery(fallback, 'en', logger, dialog, 'darwin')).resolves.toBe('exit')
    expect(dialog).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('dialog unavailable'))
  })
})

describe('AWiki recovery terminal handoff', () => {
  it.each(['darwin', 'win32'] as const)('keeps recovery pending until the %s launcher succeeds', async platform => {
    let complete!: () => void
    const opened = new Promise<void>(resolve => { complete = resolve })
    const open = vi.fn(() => opened)
    const show = vi.fn(async (_options: import('electron').MessageBoxOptions) => ({ response: 0 }))
    let ended = false
    const recovery = recoverAwikiCompatibility(fallback, 'zh', { error: vi.fn() }, show, open, platform)
      .then(() => { ended = true })
    await vi.waitFor(() => { expect(open).toHaveBeenCalledOnce() })
    expect(open).toHaveBeenCalledWith('dsh plugin add @awiki/dsh-plugin@0.3.17 @awiki/dsh-model-proxy@0.1.11')
    expect(ended).toBe(false)
    complete()
    await recovery
    expect(ended).toBe(true)
  })

  it('shows launch failure with the exact command and allows explicit retry', async () => {
    const show = vi.fn(async (_options: import('electron').MessageBoxOptions) => ({ response: 0 }))
    const open = vi.fn().mockRejectedValueOnce(new Error('launcher failed')).mockResolvedValueOnce(undefined)
    await recoverAwikiCompatibility(fallback, 'en', { error: vi.fn() }, show, open, 'darwin')
    expect(open).toHaveBeenCalledTimes(2)
    expect(show).toHaveBeenCalledTimes(2)
    expect(show.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      detail: expect.stringContaining('launcher failed'),
      buttons: ['Open DSH Terminal', 'Exit'],
    }))
    expect(show.mock.calls[1]?.[0].detail).toContain('@awiki/dsh-plugin@0.3.17')
  })

  it('exits after launch failure only when the user chooses exit', async () => {
    const show = vi.fn().mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 })
    const open = vi.fn().mockRejectedValue(new Error('launcher failed'))
    await recoverAwikiCompatibility(fallback, 'zh', { error: vi.fn() }, show, open, 'win32')
    expect(show).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledOnce()
  })

  it('does not offer an unsupported platform a terminal action', async () => {
    const show = vi.fn(async (_options: import('electron').MessageBoxOptions) => ({ response: 0 }))
    const open = vi.fn()
    await recoverAwikiCompatibility(fallback, 'en', { error: vi.fn() }, show, open, 'linux')
    expect(open).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledWith(expect.objectContaining({
      buttons: ['Exit'], cancelId: 0,
      detail: expect.stringContaining('@awiki/dsh-plugin@0.3.17'),
    }))
  })
})
