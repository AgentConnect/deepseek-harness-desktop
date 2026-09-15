# Desktop v2 消费端发布门禁

`yarn workspace dsh-plugin-desktop verify:awiki-updates` 是正式固定依赖检查，
同时接入根 `check:runtime-inputs`、Desktop `check`、两个平台的 package check
和所有打包命令。它读取 SHA 校验过的实际 AWiki npm 归档，执行其中的 decoder，
验证未绑定租户时的当前版本、两个租户的推荐信息和跨租户 URL 拒绝行为；随后检查
实际安装的插件、Identity、Model Proxy 与 Host peer 组合，并检查实际安装的 decoder。

当前清单仍固定 AWiki 0.3.10，该归档只接受 v1，因此此门禁明确失败。2026-09-15
核对的已发布 0.3.11 仍只接受 v1，不能通过改一个版本号解决。F1 的最终制品闭合
尚未完成，Desktop PR 不应在此门禁失败时合并或发布。源码联调和候选归档通过
不能解除这个阻断，也不能把 v2 标成 v1 或伪造归档版本、哈希。

同批 review 可先审核 DSH PR #62 的修复和 Desktop v2 实现。依赖维护者审核并发布
兼容 AWiki/Identity/Model Proxy 及 Host 组合后，更新真实 runtime inputs 归档及摘要、
workspace package pins、resolutions 和 Yarn lock，再运行上述门禁及默认 headless gates。
固定上游 submodule 的升级若确有必要，应独立提交。最后这次依赖 pin 变更仍须 review。

`node dsh-plugin-desktop/scripts/verify-awiki-update-source.mjs` 及 CI 的
`awiki-update-source` 单独检查未发布候选归档。候选来自 `dependencies.source.json`
的完整 commit，并在独立临时检出中按原 pnpm lock 安装和打包，执行 owning prepack
检查；记录来源、dirty 状态和 SHA-256。候选检查仅证明
归档公开投影支持 v2，不证明 Desktop 默认 Host 运行时已经兼容。
