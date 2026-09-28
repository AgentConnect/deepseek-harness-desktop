# 2026-09-28：生产 Desktop 基线回合并说明

## 固定来源与本次边界

- 生产已发布来源：`f98aa53329bbe28d4ad1ccc59a3906d7ba0a533f`（v2.2.3），其已批准的 v2.2.1 基线为 `21f26ccfccbef728eb5c27868ff0f53824194dca`。
- 待合入目标：`release/0910` 的 `0c58b32adc9b25c3bb1f56db76e5e05a9f6be708`。共同祖先为 `901894de9ecbf1c5796cfaa0c4722814e7dd6e83`。
- 用户确认：同步迁移 Release 的 AWiki 兼容性恢复方式并验证。以新版已发布 Harness/runtime 和 2.2.3 的锁为基础，保留其余桌面能力。
- 本次是源码回合并整理，没有重新发布、修改线上产物或移动 v2.2.3 标签。版本号保留 2.2.3；本分支不能作为原标签的同字节来源，下次实际发布需另增版本。

## Release 独有提交的处理

| 原提交 | 原意 | 新基线中的处理 |
|---|---|---|
| `e44b8ff6c6`、`fbd2edf461` | AWiki 插件兼容性恢复交给 DSH Terminal，移除 Desktop 自行升级及说明 | 迁移至 stable/beta；删除设置页、HTTP、主进程和新版独立 Host RPC 的自升级入口。保留 Profile 选择、通用恢复和其他设置。双语 README 同步。 |
| `289422d50b`、`91bc31c94e` | Desktop 手动升级、当前租户推荐与切换失效 | 已由新版 `54289ca7ae` 移入；保留 `distribution.ts`、租户更新生命周期和设置/托盘检查。现有测试覆盖旧弹窗失效、缓存归属和不自动下载安装。新版原有 native adapter/旧安装文件清理实现不在本次重写范围。 |
| `90903ef6aa` | 打包校验使用 ESM import 条件，不能错误选择 require 或工作区包 | 新版改为选择性 ASAR，旧“完整 unpacked 镜像”校验不适用。保留新 `module-resolution` 集成测试和 `packaged-runtime-smoke` 对 CJS/ESM 条件、物理包作用域和实际 Electron CLI 的检查；不移回旧布局的 resolver。 |
| `08131e8798`、`82861fb92d`、`99baae0e1c` | 固定 bundled runtime、插件归档、发行版本及许可证来源 | 由已发布基线的 `upstream.json`、`vendor/dsh-runtime`、`sync-vendored-runtime.mjs`、Yarn 锁及当前 package/license checks 承接。保留 2.2.3 的 registry 插件版本；不混回 rc.7/rc.8 旧归档路径。 |
| `b850c3cb2a`、`82c36f3d3c` | 未发布 AWiki 来源联调与实际消费者 v2 兼容门禁 | 正式依赖已发布，新版 `verify:awiki-updates` 检查实际归档和完整 peer 组合，Direct candidate 校验保留 Windows/POSIX tar 修正。旧源码 PR #62 的临时来源锁和自动检出旧源码的 CI 作业不再作为正式构建输入。 |

这份映射说明按能力处理冲突的理由；保留双方 Git 祖先关系不代表所有旧文件逐字保留。独立 Host 是新版引入的能力，因此不能仅重放旧提交后忽略新进程的桥接接口。

## 当前实现与安全检查

- 不兼容的 AWiki 插件组合在启动处停止，显示安装内置兼容版本的命令。用户可打开当前 Profile 的 DSH Terminal 或退出；对话框失败时记录错误并退出。
- 对话框只返回用户选择，不发网络请求、不安装插件、不改 Profile；展示命令不拼接 Profile 名称或其他用户输入。版本来自既有包兼容性选择结果。
- 移除 `awiki:check` / `awiki:apply` RPC 及两个旧 HTTP 升级入口；独立 Host 的普通启动、身份依赖加载、AA 两种启动方式和认证访问继续由原集成测试验证。
- 保留原有租户策略、身份与密钥存储、聊天数据、账户恢复和桌面通用 Recovery。没有新增远程安装能力或允许升级的兼容后门。
- 按已确认的 CI 规则，将新版继承的两个 workflow 的 PR/push 触发去掉，保留手动 workflow_dispatch；其他发行工作流的输入和权限不变。

## 本次验证

- `corepack yarn install --immutable`：通过，未改依赖锁；现有 peer 警告保留。
- stable/beta 各自 `build` 与 `typecheck`：通过。
- beta 聚焦 9 个文件：168 passed / 1 skipped；stable 聚焦 12 个文件：274 passed / 1 skipped。每个 skipped 均为 Windows 专用用例，本机是 macOS。范围包括恢复对话框、Profile 兼容选择、设置 API、Host 生命周期/实际认证启动、租户更新；stable 另查 ESM 与打包校验。
- 随后补充旧 HTTP 入口的认证 POST 返回 404：stable/beta 各 2 项 Host 集成用例通过；RPC 拒绝已移除方法由 Host 单元测试覆盖。
- stable/beta `verify:awiki-updates`：各 4 项契约测试及实际插件 v2 / Host / Identity / Model Proxy peer 校验通过。
- `check:desktop-variants`：185 个共享源文件一致。
- 初次聚焦检查在构建前执行，缺少生成的 client/Host 文件导致 2 项失败；构建后重跑通过。初次 layout 因 submodule 尚未初始化失败，固定 submodule 初始化后，最终 `check:layout` 通过：双语文档、依赖方向、stable/beta 各 265 个 runtime 包、185 个共享源文件和工作区布局均一致。

未执行生产 System Test 或 DSH Web 全量 E2E：本次变更属于 Desktop 启动/设置/本机进程边界，未修改跨服务或插件 Web 业务协议；使用拥有这些入口的 Desktop 单元和实际 Host 集成测试。未重建 Windows/macOS 安装包、签名、公证或执行 GUI 人工验收；这仍是源码 review PR，不作为新的生产发布验收。
