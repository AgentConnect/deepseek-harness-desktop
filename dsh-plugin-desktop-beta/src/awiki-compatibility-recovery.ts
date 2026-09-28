/** Ask for local compatibility recovery; never discover or install plugin updates. */
import type { MessageBoxOptions } from 'electron'
import type { DesktopAwikiCompatibilityFallback } from './awiki-package-compatibility.ts'
import type { DesktopLogger } from './desktop-logger.ts'

export async function requestAwikiCompatibilityRecovery(
  fallback: DesktopAwikiCompatibilityFallback,
  locale: 'en' | 'zh',
  logger: Pick<DesktopLogger, 'error'>,
  showMessageBox: (options: MessageBoxOptions) => Promise<{ response: number }>,
): Promise<'terminal' | 'exit'> {
  // The launcher opens a Profile-scoped DSH terminal. Omitting --profile keeps
  // display text out of shell syntax and lets the terminal own Profile routing.
  const command = `dsh plugin add @awiki/dsh-plugin@${fallback.pluginVersion} @awiki/dsh-model-proxy@${fallback.modelProxyVersion}`
  const copy = locale === 'zh'
    ? {
        title: '需要恢复 AWiki 本地兼容性',
        message: '当前 Profile 中的 AWiki 插件组合不兼容，DSH Desktop 已停止启动以避免功能异常。',
        detail: [
          'DSH Desktop 不会自动修改 Profile。以下命令只使用当前安装内置的兼容版本恢复本地 Profile；租户更新策略仍由 DSH 管理。请在打开的 DSH Terminal 中运行，然后重启 DSH：',
          '',
          command,
        ].join('\n'),
        terminal: '打开 DSH Terminal',
        exit: '退出',
      }
    : {
        title: 'AWiki local compatibility recovery required',
        message: 'The AWiki package pair in this Profile is incompatible. DSH Desktop stopped startup to avoid feature failures.',
        detail: [
          'DSH Desktop will not modify the Profile automatically. This command only restores the local Profile with compatible versions built into the current installation; DSH continues to own tenant update policy. Run it in the opened DSH Terminal, then restart DSH:',
          '',
          command,
        ].join('\n'),
        terminal: 'Open DSH Terminal',
        exit: 'Exit',
      }
  try {
    const result = await showMessageBox({
      type: 'warning',
      title: copy.title,
      message: copy.message,
      detail: copy.detail,
      buttons: [copy.terminal, copy.exit],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    return result.response === 0 ? 'terminal' : 'exit'
  } catch (cause) {
    logger.error(`dsh-plugin-desktop: failed to show AWiki recovery choice: ${cause instanceof Error ? cause.message : String(cause)}`)
    return 'exit'
  }
}
