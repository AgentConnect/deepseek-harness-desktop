# AWiki 私聊修复的本地候选验证

在 `dsh-awiki` 完成构建、生成物同步及 `pnpm run verify` 后，将当前包打包到本地临时目录。
本仓通过现有源码联调入口执行 Direct、Provider、文本／附件／listener 和原生 Recovery
准备测试，并核对候选包中的 Host、Provider、Browser、Remote 及共享 SDK 分块与该源码构建逐字节一致。

```sh
DSH_AWIKI_TENANT_SOURCE_ROOT=/absolute/path/to/dsh-awiki \
DSH_AWIKI_CANDIDATE_TARBALL=/absolute/path/to/awiki-dsh-plugin-0.3.11-rc.1.tgz \
corepack yarn workspace dsh-plugin-desktop verify:awiki-direct-source

node --test dsh-plugin-desktop/scripts/awiki-direct-candidate.test.mjs
corepack yarn workspace dsh-plugin-desktop exec vitest run tests/awiki-package-compatibility.spec.ts
```

输出记录候选 SHA-256、源码提交和 dirty 状态。该入口不替换正在运行的 Desktop、个人 profile
或正式依赖，不执行 npm publish。正式发布阶段仍需更新 Desktop 的插件／Model Proxy 包对、
运行时依赖清单和锁文件，并执行实际 Desktop 加载验收；源码和候选包通过不能代替该证据。

本地原生 Recovery 测试验证错误首页地址、清空当前 Core 所属数据以及生成同 Handle 的正确
新身份。清空后的最终提交需要读取权威 HTTPS 文档，完整跨域 Recovery／双向新消息验收由
`awiki-system-test` 的 fresh-Recovery Direct case 承担，本轮本地验证不访问生产账号。
