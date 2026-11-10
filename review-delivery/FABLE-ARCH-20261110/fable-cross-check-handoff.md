# 云端交接：Nexty 平台架构交叉复核（Fable 5.2）

> 本文件是交给新 Fable 5.2 云端会话的开场说明，由上一轮（实际模型 claude-opus-5-5）起草并经用户确认。

## 0. 角色与模型
- 你是独立交叉复核节点，不是实施节点，也不是最终评审方。产出由主控（Codex）核验；你不能批准任何交付，包括你自己的和上一轮的。
- 本会话应运行在 Fable 5.2 上。开工第一步调用 get_session（claude-code-remote，session_id 省略），记录 configured_model、session_context.model、external_metadata.last_served_model。如果不是 Fable 5.2，在交付开头如实写明，然后继续，不要自行切换。
- 全程使用中文。

## 1. 背景
仓库 sunpcm/biubiuniu。平台目标：把 BiuBiuNiu 的 Auth、组织、计费积分和 Nano 能力沉淀为版本化的 @sunpcm/niu-* 包，供第二个独立产品装配使用。

上一轮（实际模型 claude-opus-5-5，不是 Fable）已产出第二意见，位于分支 claude/fable-architecture-review-20261110 的 review-delivery/FABLE-ARCH-20261110/。评审内容以提交 065ebcf 为准；之后的提交只新增了本交接文件。它只是待核验的声明，不是权威。

## 2. 开工核对（不一致就停下报告）
```bash
git fetch origin codex/nexty-platform-overnight-20261105 claude/fable-architecture-review-20261110
git checkout -B codex/nexty-platform-overnight-20261105 origin/codex/nexty-platform-overnight-20261105
git rev-parse HEAD              # 期望 ae5ae2cf9f10fe2bb5fc1969215ff8aee9ccbb3e
git status --short --branch     # 期望工作树干净
node --version; pnpm --version  # 期望 v24.15.0 / 10.26.0
```
上一轮的交付不在开发分支上，阅读时用：
`git show origin/claude/fable-architecture-review-20261110:review-delivery/FABLE-ARCH-20261110/<文件>`。

然后按仓库规则先读 AGENTS.md、HANDOFF.md、TODO.md、docs/platform-architecture.md、docs/agent-review-loop.md、docs/migrations-canonical.md。仓库规则与本文冲突时以仓库规则为准，并在交付中注明。

已知环境坑（上一轮实测，请自行再核实）：
- 宿主自带 Node 是 v22。上一轮从 nodejs.org 下载官方 v24.15.0 到 scratchpad，校验 SHA256 后通过 PATH 前缀使用。
- 干净 checkout 上直接跑 `pnpm exec turbo run typecheck` 会失败，需要先跑 `pnpm build:packages`。
- `pnpm test:engineering` 在代理环境下在线安装会挂起。上一轮的做法是先在 scratchpad 预热 metadata，再用 ENGINEERING_PNPM_INSTALL_MODE=offline 加 ENGINEERING_PNPM_STORE_DIR 运行。
- `pnpm test:domain` 缺 PG 变量时会 fail，不是 skip。

## 3. 本轮任务

### 第一步：先独立判断，暂不看上一轮结论
在**没有阅读** architecture-second-opinion.md 之前，对下列声明逐条读代码，给出 成立 / 部分成立 / 不成立 / 无法判断，并附上自己读到的 file:line（以 ae5ae2c 为准）：
- C1 Nano unknown 不释放 nano_active_jobs，而该表对 user/organization 是 ON DELETE RESTRICT；应用里没有把 unknown 推到终态的入口；结果是已扣费未退款，并且用户或组织无法删除。
- C2 SIGTERM 时只 clearInterval；next start 不会等待进程内派发，在途任务 lease 过期后变成 unknown。
- C3 参考应用只跑 _n2 迁移链；包内 _niu profile 链和 checkProfileCompatibility 只被测试使用；两条链的 DDL 是否等价。
- C4 任意组合的内部安装闭包都是 7 个包；开组织时强制要求 billing；release gate 没有覆盖 auth profile。
- C5 输入和结果图片以 base64 存在 PG 行里，列表查询读取整行。
- C6 productId 默认取品牌名 siteConfig.name。
- C7 NanoStudio 在 await admit 之后不核对会话归属；本地任务键是全局的。
- C8 生命周期有四种写法，惰性 Promise 会缓存失败，生产环境没有 closeDatabase。
- C9 现在不值得拆独立 Worker。

把这一步的结论单独写成一节，标明“独立判断”。

### 第二步：对照上一轮
阅读上一轮主文档和 evidence/，逐项列出：
1. 你同意的结论；
2. 你不同意的结论，附反证 file:line；
3. 你认为它遗漏的问题；
4. 你认为它排序或建议不当的地方。

重点核对：M1（provider 的 5xx、网络错误、超时都会归为 unknown）、M10（外键名超长被截断）、C7 的“应按 subject 而不是 userId 隔离”、§3 两份设计稿（unknown 对账、AuthSeatPolicy）是否可行，以及有没有更小的改法。

### 第三步：复跑探针
用户授权：可以在本容器 scratchpad 内自建临时 PostgreSQL 16 集群（只监听 127.0.0.1，使用会话专属的空库，库名以 fable_probe_ 开头），运行 evidence/probe-c1-c2-unknown.mjs。

- 运行前先读完脚本，确认它只做合成数据操作且带身份 guard。
- 脚本需要放在仓库内的路径才能解析 @sunpcm/* 包。请复制到你自己的交付目录 evidence/ 下再运行，不要改动上一轮的目录。
- 记录命令、退出码和输出，用完停掉集群。
- 这只算补充证据，不能冒充 docs/agent-review-loop.md 规定的标准隔离库，也不能把仓库自带的 PG 用例记为通过。

## 4. 允许与禁止
**允许**：
- 只读阅读全仓；git 只读命令及上面的 fetch/checkout；
- HUSKY=0 pnpm install --frozen-lockfile；
- 不连 PG 的检查（typecheck、test:packages、test:engineering、test:routing）；
- 第三步的临时 PG。

每条命令都记录退出码和摘要。

**禁止**：
- 修改产品代码、测试、依赖、锁文件、配置或既有文档；修改上一轮的交付目录；
- 读取或复制真实 .env 和凭据；调用真实 AI、支付、SSO 或 registry；连接任何非自建的库；
- 部署或发布；git clean、stash、reset、rebase、merge；
- push 到 codex/nexty-platform-overnight-20261105、main 或 claude/fable-architecture-review-20261110。

不要把历史数字（448/448、22/22 等）或上一轮结论写成当前结论。

**停止条件**：基线不一致；结论必须依赖业务口径才能继续；需要修改产品文件才能验证；需要真实外部依赖。遇到时写明证据，给出 2–4 个选项和推荐项，然后停下。

## 5. 交付
- 新目录 review-delivery/FABLE-XCHECK-20261111/：主文档 cross-check.md，证据放在 evidence/。
- 从 ae5ae2c 新建分支 claude/fable-cross-check-20261111，只提交这一个目录并 push 该分支（用户已授权）。不开 PR，不合并，不 push 其他分支。
- 主文档结构：
  1. 实际模型与基线核对；
  2. 独立判断（第一步）；
  3. 与上一轮的对照（第二步）：同意 / 不同意 / 遗漏 / 排序意见，发现按 P0/P1/P2 排序，并区分代码事实、推断和偏好；
  4. 探针复跑结果（第三步）；
  5. 需要用户决策的事项；
  6. 执行记录：已运行的命令及退出码、未运行项及原因、外部依赖状态。

完成后用几行话总结，给出分支名和文件路径，然后停在 Review。
