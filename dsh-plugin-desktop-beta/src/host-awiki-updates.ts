/** AWiki updates remain owned by Electron while the DSH Host serves the UI. */
import type { DesktopSettingsControllerBootstrap } from './desktop-settings-controller.ts'
import type { HostRpc } from './host-rpc.ts'

export type DesktopAwikiUpdates = Pick<DesktopSettingsControllerBootstrap, 'checkAwikiUpdate' | 'prepareAwikiUpgrade'>

export function bindAwikiUpdates(rpc: HostRpc, updates: DesktopAwikiUpdates): () => void {
  const releases = [
    rpc.handle('awiki:check', () => updates.checkAwikiUpdate()),
    rpc.handle('awiki:apply', ([current, target]) => {
      const prepared = updates.prepareAwikiUpgrade(current, target)
      // The child calls only after its HTTP response has completed.
      prepared.afterResponse?.()
      return prepared.response
    }),
  ]
  return () => releases.forEach(release => release())
}

export function createHostAwikiUpdates(rpc: HostRpc): DesktopAwikiUpdates {
  return {
    checkAwikiUpdate: () => rpc.call('awiki:check'),
    prepareAwikiUpgrade: (current, target) => ({
      response: { accepted: true, restartRequired: true },
      afterResponse: () => {
        void rpc.call('awiki:apply', [current, target]).catch(error => {
          process.stderr.write(`AWiki update handoff failed: ${String(error)}\n`)
        })
      },
    }),
  }
}
