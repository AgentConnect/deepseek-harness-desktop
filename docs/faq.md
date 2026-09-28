# DSH Desktop 常见问题

[English](faq.en.md)

本页回答当前正式版本最常见的安装、平台、运行环境和插件问题。功能范围以[最新 GitHub Release](https://github.com/anywhere-labs/deepseek-harness-desktop/releases/latest)和[用户指南](user-guide.md)为准。

## DSH Desktop 是什么？

DSH Desktop 是面向 Windows 和 macOS 的开源 DeepSeek Harness 桌面客户端。它把官方 Harness 的本地 Web UI、Host 服务和插件系统装进原生桌面应用，并提供窗口、系统托盘、终端、更新和 profile 管理。

## 这是 DeepSeek 官方产品吗？

不是。DSH Desktop 是社区维护的独立开源项目，不隶属于 DeepSeek，也未获得 DeepSeek 官方背书。项目名称仅用于说明它与官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的技术关系。

## 支持哪些操作系统？

当前正式安装包支持 Windows x64 和 universal macOS（Intel 与 Apple Silicon）。当前没有 Linux 安装包；不要根据源码中存在跨平台兼容代码推断已经发布了对应安装包。

## 需要安装 Node.js、pnpm 或 DSH 吗？

不需要。安装包已经包含 Electron、Node.js、pnpm 和固定版本的 DSH 依赖。普通用户下载安装后即可启动，Desktop 也不会修改系统全局 PATH 或用户的 shell 配置。

## 首次启动需要下载运行环境吗？

不需要另行下载 Node.js 或 Harness 核心。安装包较大，是因为运行时和固定版本依赖已经包含在内，以换取更确定的首次启动和版本组合。使用云端模型、检查更新或下载新版本时仍然需要网络。

## DSH Desktop 会修改官方 Harness 吗？

不会。仓库固定一个未修改的官方 Harness 上游版本。兼容模式在独立 overlay frame 下运行上游默认 Web client；扩展窗口与增强模式分别通过插件/profile composition 边界安装各自的 Desktop root registration，并继续承载官方 slot occupant。所有模式都不会直接修改上游源码。

## 数据是否保存在本地？

Desktop Host、profile 和 DSH home 位于本机。是否向外部服务发送内容取决于用户配置的模型或工具提供商；使用云端模型时，相应请求仍会发送给该提供商。

## 可以安装 DSH 插件吗？

可以。DSH Desktop 使用官方 Harness 插件体系。可以从托盘打开 DSH Terminal，然后运行 `dsh plugin add`、`dsh plugin remove` 和 `dsh plugin update`；命令默认作用于当前激活的 profile，插件变更后需要重启 Desktop。

## Desktop profile 和已有 web profile 会自动同步吗？

不会自动复制插件。每个 profile 都有自己的 bundle 和依赖组合；切换 profile 后，终端中的默认插件命令会作用于当前 profile，也可以使用 `--profile <name>` 显式指定目标。

## 应用如何更新？

打包后的应用按当前 AWiki 租户检查更新。稳定版仅推荐正式版，预发布版会比较正式与预发布通道；只有更高版本才提示升级。设置与托盘共用更新结果，切换租户立即清除旧推荐，已打开的旧弹窗也不能打开旧租户下载页。网络失败可展示当前租户已验证的缓存；没有策略时显示暂无更新信息。用户前往当前租户下载页选择安装包，手动安装并重新打开应用。

## 在哪里下载和报告问题？

从[项目下载页](https://www.dshdesktop.cn/)或[最新 GitHub Release](https://github.com/anywhere-labs/deepseek-harness-desktop/releases/latest)下载安装包。遇到问题时先查看[用户指南的排查部分](user-guide.md#排查)，仍无法解决再提交 [GitHub Issue](https://github.com/anywhere-labs/deepseek-harness-desktop/issues/new/choose)，并附上操作系统、应用版本、复现步骤和错误信息。
