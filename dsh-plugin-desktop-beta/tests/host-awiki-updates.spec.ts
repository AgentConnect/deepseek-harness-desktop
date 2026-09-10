import { MessageChannel } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { HostRpc } from '../src/host-rpc.ts'
import { bindAwikiUpdates, createHostAwikiUpdates } from '../src/host-awiki-updates.ts'

it('keeps update discovery in the supervisor and applies the exact pair only after HTTP acknowledgement', async () => {
  const { port1, port2 } = new MessageChannel()
  const peers = [port1, port2].map(port => new HostRpc({
    send: message => port.postMessage(message),
    listen: receive => { port.on('message', receive); return () => { port.off('message', receive) } },
  }))
  const parent = peers[0]!
  const child = peers[1]!
  const current = { pluginVersion: '0.3.9', modelProxyVersion: '0.1.5' }
  const target = { pluginVersion: '0.3.10', modelProxyVersion: '0.1.6' }
  const afterResponse = vi.fn()
  const prepare = vi.fn(() => ({ response: { accepted: true as const, restartRequired: true as const }, afterResponse }))
  const check = vi.fn(async () => ({ status: 'available' as const, current, target }))
  const release = bindAwikiUpdates(parent, { checkAwikiUpdate: check, prepareAwikiUpgrade: prepare })
  try {
    const client = createHostAwikiUpdates(child)
    await expect(client.checkAwikiUpdate()).resolves.toEqual({ status: 'available', current, target })
    const pending = client.prepareAwikiUpgrade(current, target)
    expect(pending.response).toEqual({ accepted: true, restartRequired: true })
    expect(prepare).not.toHaveBeenCalled()
    expect(afterResponse).not.toHaveBeenCalled()
    pending.afterResponse?.()
    await vi.waitFor(() => expect(afterResponse).toHaveBeenCalledTimes(1))
    expect(prepare).toHaveBeenCalledWith(current, target)
    release()
    await expect(client.checkAwikiUpdate()).rejects.toThrow('Unknown Host operation')
  } finally {
    release(); peers.forEach(peer => peer.close()); port1.close(); port2.close()
  }
})
