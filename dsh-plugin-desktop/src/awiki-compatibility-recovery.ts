/** Ask for local compatibility recovery; never discover or install plugin updates. */
import type { MessageBoxOptions } from 'electron'
import type { DesktopAwikiCompatibilityFallback } from './awiki-package-compatibility.ts'
import type { DesktopLogger } from './desktop-logger.ts'

/** The installation manifest supplies the compatible pair; no Profile input enters the command. */
export function awikiRecoveryCommand(fallback: DesktopAwikiCompatibilityFallback): string {
  return `dsh plugin add @awiki/dsh-plugin@${fallback.pluginVersion} @awiki/dsh-model-proxy@${fallback.modelProxyVersion}`
}

export async function requestAwikiCompatibilityRecovery(
  fallback: DesktopAwikiCompatibilityFallback,
  locale: 'en' | 'zh',
  logger: Pick<DesktopLogger, 'error'>,
  showMessageBox: (options: MessageBoxOptions) => Promise<{ response: number }>,
  platform: NodeJS.Platform = process.platform,
  launchError?: string,
): Promise<'terminal' | 'exit'> {
  // The launcher opens a Profile-scoped DSH terminal. Omitting --profile keeps
  // display text out of shell syntax and lets the terminal own Profile routing.
  const command = awikiRecoveryCommand(fallback)
  const terminalSupported = platform === 'darwin' || platform === 'win32'
  const copy = locale === 'zh'
    ? {
        title: '需要恢复 AWiki 本地兼容性',
        message: '当前 Profile 中的 AWiki 插件组合不兼容，DSH Desktop 已停止启动以避免功能异常。',
        detail: [
          'DSH Desktop 不会自动修改 Profile。以下命令只使用当前安装内置的兼容版本恢复本地 Profile；租户更新策略仍由 DSH 管理。请在当前 Profile 对应的终端中手动运行，然后重启 DSH：',
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
          'DSH Desktop will not modify the Profile automatically. This command only restores the local Profile with compatible versions built into the current installation; DSH continues to own tenant update policy. Run it manually in a terminal for the current Profile, then restart DSH:',
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
      detail: [
        ...(launchError === undefined ? [] : [locale === 'zh'
          ? `终端未能打开：${launchError}。请检查后重试，或退出。`
          : `Unable to open the terminal: ${launchError}. Check and retry, or exit.`, '']),
        ...(!terminalSupported ? [locale === 'zh'
          ? '当前平台不支持内置终端。请记录下方命令，使用此 Profile 对应的终端手动处理。'
          : 'This platform has no built-in terminal support. Save the command below and use a terminal for this Profile.', ''] : []),
        copy.detail,
      ].join('\n'),
      buttons: terminalSupported ? [copy.terminal, copy.exit] : [copy.exit],
      defaultId: 0,
      cancelId: terminalSupported ? 1 : 0,
      noLink: true,
    })
    return terminalSupported && result.response === 0 ? 'terminal' : 'exit'
  } catch (cause) {
    logger.error(`dsh-plugin-desktop: failed to show AWiki recovery choice: ${cause instanceof Error ? cause.message : String(cause)}`)
    return 'exit'
  }
}

/** Own the startup handoff: retry stays visible; only an opened terminal or exit ends recovery. */
export async function recoverAwikiCompatibility(
  fallback: DesktopAwikiCompatibilityFallback,
  locale: 'en' | 'zh',
  logger: Pick<DesktopLogger, 'error'>,
  showMessageBox: (options: MessageBoxOptions) => Promise<{ response: number }>,
  openTerminal: (command: string) => Promise<void>,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  let launchError: string | undefined
  while (await requestAwikiCompatibilityRecovery(fallback, locale, logger, showMessageBox, platform, launchError) === 'terminal') {
    try {
      await openTerminal(awikiRecoveryCommand(fallback))
      return
    } catch (cause) {
      launchError = cause instanceof Error ? cause.message : String(cause)
      logger.error(`dsh-plugin-desktop: AWiki recovery terminal failed: ${launchError}`)
    }
  }
}
