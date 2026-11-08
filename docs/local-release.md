# 本地发布产物与 manifest 工具

`scripts/release/` 是一组本地模拟发布工具：使用 Node 内建模块、根 `devDependencies`
中精确声明的 `semver@7.8.6`，调用真实 `npm` CLI 与 loopback registry 的 HTTP 协议，
但不自行实现 registry。工具只消费已审核 tarball，不执行 `build`、`pack` 或
`prepublish`；发布负责人须在工具之外完成构建、打包和产物审核。本文只描述源码中的
静态行为，不声明本机运行或当前阶段验收已通过。

## 运行环境与边界

- 根 `package.json` 要求 Node `>=24.15.0 <25`。`publish-local` 与 `promote-local`
  执行前调用 `npm --version`，要求主版本至少为 11；其余命令不做此检查。
- `semver@7.8.6` 是根 `devDependencies` 的直接精确依赖，用于版本解析、范围判断和
  稳定版本判定，因此本工具并非“无第三方运行时”。registry 回读使用 Node 内建
  `fetch`，本地摘要与 JSON 校验使用 Node 内建 crypto / fs；不新增依赖。
- `--registry` 仅接受 `http://127.0.0.1:<port>` 或 `http://[::1]:<port>`；拒绝
  `localhost`、https、userinfo、额外 path/query/fragment、跨 origin 的 `dist.tarball`
  和 redirect。`publish-local` / `promote-local` 的最小子进程环境注入
  `request-guard.cjs`，把 npm publish / dist-tag 所用 HTTP 与 TCP 目标约束到给定
  loopback origin 与精确 host+port；`--audit` 可记录不含凭据的最终目标。父进程的
  metadata / tarball `fetch` 由工具自身限制同 origin、禁止 redirect，不经过该 preload。
  外部 `NODE_OPTIONS` 不被信任。
- `npm publish` 带 `--ignore-scripts`，隔离 npmrc 也设置 `ignore-scripts=true`；
  user/global npmrc 是两个独立的 0600 文件，cache 隔离，auth 写入 0600 文件，
  不重设 HOME，CLI 日志不主动输出 token。`--auth-token` / `--auth` 只用于自有
  loopback 的合成凭据：`--auth-token` 会出现在调用 CLI 的 argv，可能进入 shell 历史
  或被本机进程列表看到，不得放入真实凭据；写入隔离 npmrc 并不消除这一暴露。

### 认证合同（Verdaccio 7.0.2 默认模式）

stock Verdaccio 7.0.2 默认采用 JWT API 模式：Basic 凭据只适用于服务端支持的登录路由，
包发布与 `whoami` 需要服务端签发的 Bearer token。本地受控 fixture 已用合成账户验证：
`PUT /-/user/org.couchdb.user:<encoded-user>` 携带 Basic 头及含 `name` 与合成密码字段的
JSON 可返回 `201` 和 token，随后以该 token 的 Bearer 形式调用 `whoami` 返回 `200`。
因此默认模式下直接向 publish 传 `--auth <synthetic-base64>` 会得到 `401`；
`--auth-token` 必须填服务端签发的 token，明文密码不能替代。当前产品 CLI 没有 `login`
子命令，真实登录由受控本地 fixture / 调用者实现，本文不示范未实现的命令。`--auth`
仍保留给明确支持 Basic 的自有 fixture 配置；所有凭据仅限合成、本地 loopback，
真实 registry 仍未授权，也不向 SaaS 发送凭据。本节仅说明协议差异，不表示 Linux
整体验收已通过。

## 入口与 allowlist

```bash
node scripts/release/cli.mjs --help
```

默认 allowlist 为 `release/packages.json`，接口固定为
`{ schemaVersion: 1, scope, packages: [{name, path}] }`。`name` 必须以 `scope + "/"`
开头，`path` 必须是无绝对路径、无 `..` 的相对路径，归一化后去重。当前完整十项是
九个业务包加可独立发布的 `@sunpcm/niu-prettier-config`：

| 包名 | 相对路径 |
| --- | --- |
| `@sunpcm/niu-auth` | `packages/auth` |
| `@sunpcm/niu-commerce` | `packages/commerce` |
| `@sunpcm/niu-contracts` | `packages/contracts` |
| `@sunpcm/niu-db` | `packages/db` |
| `@sunpcm/niu-feature-nano` | `packages/feature-nano` |
| `@sunpcm/niu-next` | `packages/next` |
| `@sunpcm/niu-persistence-pg` | `packages/persistence-pg` |
| `@sunpcm/niu-prettier-config` | `packages/configs/prettier-config` |
| `@sunpcm/niu-ui` | `packages/ui` |
| `@sunpcm/niu-utils` | `packages/utils` |

allowlist 只界定可进入本地打包检查的包集合，不代表产物已生成或权限已确认。

## 操作顺序与命令

单批产物的主链为 `inspect → manifest → prepare-stable → publish-local → verify-local →
promote-local`。`prepare-stable` 会生成新 tgz；下游发布须使用由实际发布 tgz 重新执行
`inspect` / `manifest` 得到的 manifest，不能沿用预览 manifest。工具按 manifest 中的
tarball 路径和哈希核对，不会判断它属于哪个发布阶段。

### 1. inspect：核验已审 tarball

```bash
node scripts/release/cli.mjs inspect <preview.tgz> \
  [--allowlist <allowlist.json>] [--json]
```

核验身份/版本/allowlist、tar 成员与路径、exports 目标、禁止的依赖协议及产品 env 等。
内部强/optional 依赖须为精确版本；内部 peer 允许合法 SemVer 范围，由闭包阶段判断。

### 2. manifest：生成确定性发布清单

```bash
node scripts/release/cli.mjs manifest \
  --artifact <package-name>=<preview.tgz> \
  --source-commit <40-hex-sha> [--channel preview] \
  --out <preview-manifest.json>
```

每个入选 tarball 使用一条 `--artifact name=path`。manifest 按键排序、无时间戳，自引用
`manifestHash`；`sourceCommit` 由调用者绑定 40 位 hex，不从 dirty worktree 推断。
`payloadHash` 绑定安装内容，发布 preflight 会重算 `manifestHash`，并逐包核对 tarball
的 `sha256`、`sri`、`payloadHash`、`databaseContract`、依赖字段、身份、allowlist 和依赖
闭包；任何不一致都在子进程或 HTTP 副作用前失败。

### 3. prepare-stable：生成稳定 tarball

```bash
node scripts/release/cli.mjs prepare-stable <preview.tgz> \
  --version <stable-semver> \
  --internal-versions '{"<package-name>":"<stable-semver>"}' \
  --out <stable.tgz>
```

只改产物 `package.json` 的 `version` 与内部强/optional 依赖精确版本，不重新构建，
不覆盖输入，也不覆盖已存在输出；peer 范围不覆盖目标时明确报错。对每个稳定 tgz
重新 `inspect` 并重新生成 manifest 后，会得到新的 `manifestHash`：必须重新准备真实
Gate 与 evidence，不能复用预览 manifest 或旧版本结果。

### 4. publish-local：发布候选到 loopback registry

```bash
node scripts/release/cli.mjs publish-local <candidate-manifest.json> \
  --registry http://127.0.0.1:<port> \
  [--tag candidate] [--auth-token <synthetic-token>] \
  --receipts <receipts.json> [--npm <npm-binary>]
```

`--tag` 仅允许 `candidate`（默认）或 `next`，拒绝 `latest` / `stable`。按依赖拓扑序
逐包查询精确版本与发布前 `dist-tags` baseline：已存在且 tarball / metadata 完整性
一致则复用，缺失时先在副作用前把 baseline 与 `pending` 写入 receipts，再 `npm publish`
原 tgz 并回读。回读要求所选 tag 精确指向该版本，且 `latest` 与 baseline 完全一致，
包括「先前不存在」的 absent→present 也会被拒绝；无 baseline 时 fail closed。
receipts 绑定 manifest、registry、baseline 与逐包 status，原子写入。

重复执行同一 manifest / registry / receipts 可按远端事实恢复：复用已存在版本或补完
`pending` 步骤，恢复时使用副作用前保存的 baseline，而非当前 tags 重建基线；未指定
`--receipts` 时没有持久化恢复记录。命令同时支持 `--auth <synthetic-base64>` 与
`--audit <audit-file>`；前者是合成 basic auth，仅适用于明确支持 Basic 的自有 fixture
配置；二者都用于上述隔离 loopback 调用。

新建的 receipts 顶层 `tag` 固定为 `candidate`；`publish-local` 不会把它改成实际选择的
`--tag next`，也不会在此处校正既有 receipts 的其他 tag。`verify-local` 没有 `--tag`
参数，固定按 `candidate` 回读；`promote-local` 也要求 `candidate` receipts 并在提升前
按 `candidate` 重新回读。因此走稳定提升路径应使用默认 `candidate`，仅以 `next` 发布
的批次不能当作等价的提升输入。

### 5. verify-local：回读确认

```bash
node scripts/release/cli.mjs verify-local <candidate-manifest.json> \
  --registry http://127.0.0.1:<port> \
  [--receipts <receipts.json>] [--json]
```

读取 metadata 与 tarball，核对 manifest 的 `sha256` / `sri` 及 metadata 的实际
`dist.integrity`（npm 常用 sha512），并按 `candidate` tag 校验精确版本，要求 `latest`
保持发布前状态。提供 `--receipts` 时，从逐包 receipt 读取 baseline；未提供时基线为
空对象：`latest` 从缺失变为存在会被拒绝，但 `latest` 仍缺失时回读可能通过。稳定
提升不采用这种省略 baseline 的路径，它要求完整 receipts。

### 6. promote-local：本地稳定提升

```bash
node scripts/release/cli.mjs promote-local <candidate-manifest.json> \
  --registry http://127.0.0.1:<port> \
  --receipts <receipts.json> --gate <gate.json> \
  --stable-manifest <stable-manifest.json> [--tag stable]
```

稳定版本须先以 `candidate` 发布，且所有版本为无 prerelease 的稳定 SemVer。提升前
重新回读 registry、校验 receipts 的 schemaVersion、manifestHash、registry、tag 及
逐包 version/SRI/status/baseline，并通过 Gate。随后按包名排序逐包执行
`npm dist-tag add <name>@<version> stable`，每次更新后回读 metadata，fail closed
校验实际 `stable` 精确指向目标且 `latest` 与 baseline 完全一致。

registry 的多个 tag 更新不是跨包事务：任一步失败即返回 `incomplete`，已成功的
`stable` tag 保留在 registry，旧 stable manifest 保持不变，也不会写入 `.previous`；
工具不自动回滚 registry 或持久化补偿计划。修复后须依据当前 registry 状态重新执行。
全部成功时，将输入 manifest 的 `channel` 改为 `stable` 后原子替换
`<stable-manifest>`；若该文件原本存在，先把其旧内容写入
`<stable-manifest>.previous`。`.previous` 只是上一次本地 stable manifest 的快照，
每次成功提升会覆盖它，不是多版本历史，也不代表 registry tag 的整体回滚点；它的写入
与 stable manifest 的原子替换不是同一事务，中途失败时须依据当前 registry 状态恢复。
`--tag` 只接受 `stable`；输入 manifest 的 `channel` 为 `stable` 时拒绝重复提升。

## Gate 与绑定

Gate 的固定六项 ID 为 `minimal`、`auth_credits`、`nano_payments`（`kind: profile`）
及 `node`、`vite`、`next`（`kind: runtime`）。`gate.manifestHash` 与每个 check 的
`manifestHash` 必须等于当前 `manifest.manifestHash`；`gate.payloadHashes` 对每个
manifest 包必须等于其 `payloadHash`。六项必需 check 均须为 `result: passed`、
`exitCode: 0`，并指向真实 evidence JSON：其 `sha256` 与读回字节一致，内容含
`schemaVersion: 1`、匹配的 `id` / `manifestHash`、`result: passed`、`exitCode: 0`、
非空 `commands`，并对其声明覆盖的每个包给出 `version` / `payloadHash` / `sha256`。
每个 manifest 包至少被一项真实安装或内容校验 evidence 覆盖。空 evidence、错 hash、
缺必需 ID、失败结果或旧 manifest 的证明均被拒绝。工具只核验绑定、回执结构与文件哈希，
不能独立证明 evidence 的执行真实性；回执须来自实际消费运行。

```json
{ "schemaVersion": 1, "manifestHash": "<sha>", "payloadHashes": { "<name>": "<payloadHash>" },
  "checks": [
    { "id": "minimal", "kind": "profile", "result": "passed", "exitCode": 0,
      "manifestHash": "<sha>", "packages": ["<name>"],
      "evidence": { "path": "<evidence-minimal.json>", "sha256": "<sha>" } },
    { "id": "node", "kind": "runtime", "result": "passed", "exitCode": 0,
      "manifestHash": "<sha>", "packages": ["<name>"],
      "evidence": { "path": "<evidence-node.json>", "sha256": "<sha>" } }
  ] }
```

这是结构示例，省略了其余四项必需 ID；占位值不构成 Gate。新 manifest 要重新产生
真实 evidence，旧 manifest 的 Gate 结果不能复用。

## 数据库与外部边界

工具只记录数据库合同版本与 profile，不重跑旧 DDL；不兼容版本由消费者启动时只读
合同检查明确失败。`@sunpcm/niu-persistence-pg` 的合同为
`{ version: 1, profiles: [minimal, auth, auth_credits, nano_payments] }`，其余包为
`null`；兼容范围仅支持合同 `1`（区间 `[1,1]` 或数组 `[1]`），SQL journal 条数不是
合同版本号。

此工具当前仅用于本地模拟发布与本地记账，不能代替真实 private-registry 权限、
provider、SSO 或 D1b 外部门槛；许可与再分发范围也须另行确认。本文不记录当前
阶段是否通过，不把外部待验项目写成已通过。
