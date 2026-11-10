# Nexty 平台远端开发交接

本文用于从当前 checkout 接续 Nexty 平台开发。先读完本文的基线、状态和安全边界，再按
[`TODO.md`](TODO.md) 顺序选择下一项；需要理解长期合同和验证方法时，再读
[`docs/platform-architecture.md`](docs/platform-architecture.md)、
[`docs/plans/2026-11-04-nexty-platform-migration.md`](docs/plans/2026-11-04-nexty-platform-migration.md)
和 [`docs/agent-review-loop.md`](docs/agent-review-loop.md)。不要求复读整段开发历史，也不要依赖
未随仓库提供的本机提示词或私有报告。

## 仓库与固定来源

- 主仓：`sunpcm/biubiuniu`。开发分支为 `codex/nexty-platform-overnight-20261105`，集成迁移交接
  基线为 `b3820206f9828d32a19bd35cc1cd22dec3c73c20`。
- 本次新增交接文档所在提交是基线之后的纯文档提交。实际 checkout 以 `git rev-parse HEAD` 为准；
  本文不虚构该提交 SHA，也不记录尚未核实的 push 状态。
- 可选新版来源：[`WeNextDev/nexty.dev`](https://github.com/WeNextDev/nexty.dev)，固定在
  `002e97e4a4d9ae79914af054513711a90158cca5`，对应原 `next2`。
- 可选旧定制来源：[`sunpcm/nexty.dev`](https://github.com/sunpcm/nexty.dev)，固定在
  `b2342532513ffe0a36fb1951f763b44d2b7e3c52`。
- 主仓 `main` 尚未包含本次平台迁移成果；外层 `nexty_monorepo` 只是本地工作区，不是 Git
  仓库。不要把任一来源 checkout 直接复制进主仓分支。来源后续更新不改变固定的迁移基线；若任务
  要改基线，需另立明确合同并重新验证。

开始工作先核对：

```bash
git rev-parse HEAD
git status --short --branch
node --version
pnpm --version
```

已有 WIP 和任务声明的 untracked 证据应保留。不要用 `git clean`、`git stash` 或
`git reset` 清理工作树。

## 状态口径

截至 2026-11-10，历史产品实测候选为
`709dbb70a9f4d31474079fe3ef207d00c0cf6430`。N1–N3、N5 的本地验收为 `APPROVED`；
N4 的本地合成登录态浏览器验收单独为 `APPROVED`。历史本地证据还包括根测试 `448/448`、零
skip、静态 `22/22`、`106` 个既有 warnings，以及默认 Webpack 在临时 8 GiB 内存下通过。

这些数字是绑定历史候选的证据。本轮只准备文档，没有重新运行产品验收，也没有验证云端环境；
不能把历史数字写成当前 HEAD、远端 CI 或线上整体通过。

真实 AI/支付、SSO、私有 registry 和 D1b 四组仍待外部验收。N4 整体外部门槛尚未批准，P6
尚未授权。SSO 不只是联调旧入口：它需要受维护的 OAuth/OIDC 实现、精确回调和严格会话及角色
验证。原产品任务停在 Review；当前只授权文档准备和后续按权提交，任何产品实施都需用户明确恢复。

## 远端环境准备

固定运行时：

```bash
node --version   # 期望 v24.15.0
pnpm --version   # 期望 10.26.0
HUSKY=0 pnpm install --frozen-lockfile
pnpm build:packages
pnpm dev:web
```

`apps/web/.env.example` 只作为变量模板；实际值由宿主安全注入。不得复制本机真实 `.env`。
数据库使用云端新建的隔离合成 PostgreSQL，不连接生产库。精确测试变量、库名/角色 guard 和
skip 语义见 [`docs/agent-review-loop.md`](docs/agent-review-loop.md)；迁移入口和合同见
[`docs/migrations-canonical.md`](docs/migrations-canonical.md)。缺变量导致用例 skip 时，该项仍为
未验证。

不要复制会话、数据库卷、依赖缓存或整个 review 目录。本机技能、模型别名、MCP、浏览器和历史
资源在远端不保证可用；先按宿主实际能力核验。缺少浏览器能力时，把浏览器验收保留为本地执行点，
不伪造云端结果。

安装和部分根测试可能需要网络，应在环境中显式配置并记录。构建默认 4 GiB 内存不足仍是待办；
8 GiB 通过不代表问题已修复。Google 字体构建下载依赖也仍需在目标环境核实。

## 恢复顺序

用户明确恢复产品开发后，按 [`TODO.md`](TODO.md) 顺序执行：

1. 完成 Nano 本地任务键的 `userId` 隔离，覆盖旧键/退出清理、换号、pending/ready 和晚响应。
2. 统一管理员 credit ledger 的 query key 复用，不改财务计算合同。
3. 单独评估构建可靠性和内存问题，不把临时扩容当成修复。

先只读核对 HEAD、dirty/index、工具版本和隔离数据库归属，再从授权待办中选择一项做轻量实施与
独立 Review。全部 writer 停写后，按授权串行执行源码变异、PG、build、typecheck 和 root
engineering 检查。没有新的具体授权时，不 push、不调用真实 AI/支付、不访问真实 registry、
不做 D1b 存量演练、不部署，也不推进 P6。

可复制的短开场语：

```text
请先读 HANDOFF.md、TODO.md 和 AGENTS.md；只读核对当前 HEAD、dirty、Node/pnpm 与隔离合成 PG，
然后按 TODO 顺序选择一项获授权的轻量产品改动。沿用实施与独立 Review 分离，实施者不 commit/push；
保留 WIP，不接真实外部依赖，全部 writer 停写后串行运行授权检查，最后停在 Review。
```

## 验收入口

- 当前事项和恢复顺序：[`TODO.md`](TODO.md)
- 外部验收准备：[`docs/external-acceptance.md`](docs/external-acceptance.md)
- 架构边界：[`docs/platform-architecture.md`](docs/platform-architecture.md)
- 迁移计划：[`docs/plans/2026-11-04-nexty-platform-migration.md`](docs/plans/2026-11-04-nexty-platform-migration.md)
- 测试、隔离 PG 与历史口径：[`docs/agent-review-loop.md`](docs/agent-review-loop.md)
- canonical migration：[`docs/migrations-canonical.md`](docs/migrations-canonical.md)
