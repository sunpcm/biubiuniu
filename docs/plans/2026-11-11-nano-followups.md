# Nano 与平台后续任务交接（2026-11-11）

本文把交叉复核之后还没做的事拆成独立任务卡，供其他实施节点接手。每张卡可以单独做、单独 Review。

## 起点

- 分支：`claude/nano-unknown-auto-refund-20261111`，HEAD `261b274`，基于 `ae5ae2c`。尚未合并，等主控 Review。
- 背景与证据：分支 `claude/fable-cross-check-20261111` 的
  `review-delivery/FABLE-XCHECK-20261111/cross-check.md`。
- 该分支已经完成：unknown 超时自动退款、停机停止领取、sweeper 各步隔离与日志、稳定 `PRODUCT_ID`、
  读取列投影、前端按 subject 隔离、无计费组织的静态 billing 端口、typecheck 依赖上游 build。
  **不要重做这些。**

## 通用规则

- 先读 `AGENTS.md`。只改任务卡列出的文件；不 `git clean`、`stash`、`reset`；不读真实 `.env`；
  不调用真实 AI、支付、SSO、registry。
- 运行时 Node `24.15.0`、pnpm `10.26.0`，安装用 `HUSKY=0 pnpm install --frozen-lockfile`。
- 每张卡做完至少跑：`pnpm exec turbo run typecheck`、`pnpm exec turbo run lint`、`pnpm test:packages`。
  lint 基线是 `@niu/web` 的 106 个 warning、0 个 error，不能新增。
- 改了 `turbo.json` 或新增环境变量时，还要跑 `pnpm test:engineering`。新变量要同时加进
  `turbo.json` 的 `env`，以及 `test/engineering.test.mjs` 的 `stableBuildEnvironment` 和
  `hashedBuildEnvironmentOverrides` 两张表，否则 hash 测试会失败。
- `test:engineering` 在代理环境下默认在线模式会挂起。先在仓库外预热一个只装 `prettier@3.8.0` 和
  `prettier-plugin-tailwindcss@0.7.2` 的 pnpm store，再用
  `ENGINEERING_PNPM_INSTALL_MODE=offline ENGINEERING_PNPM_STORE_DIR=<store>` 运行。
- PG 用例只能连新建的隔离合成库。`test/domain/helpers.ts` 要求库名
  `nexty_overnight_20261105_n4_app`、角色 `nexty_overnight_test`、回环地址，并需要
  `DATABASE_URL`、`DOMAIN_TEST_EXPECTED_DATABASE`、`DOMAIN_TEST_EXPECTED_PORT` 三个变量。
  缺变量造成的 skip 或 fail 一律记为未验证。
- 交接格式：改了什么、写集、自检命令与退出码、未执行项、剩余风险。然后停在 Review。

## 任务卡

### T1 确认两项 auth-http 失败是否为环境问题（先做，只读）

- **现象**：在本地合成库上，注入合成 `BETTER_AUTH_SECRET` 后，`test/domain/auth-http.test.ts` 有两项失败，
  都是期望 200 实得 403：
  - `r1: built-in /admin/impersonate-user remains reachable for superadmin`（断言在 `:226`）
  - `R03: a banned user can still sign out`（断言在 `:531`）
- **要做的**：在基线 `ae5ae2c` 和本分支上，用同一套环境变量各跑一次这个文件，对比结果。
- **验收**：给出结论“基线同样失败（环境问题，并指出缺哪个变量）”或“只有本分支失败（回归）”。
  是回归就停下报告，不要自己修。
- **不改任何文件。**

### T2 浏览器验证 Nano 页面改动（需要登录态合成环境）

本分支的前端改动只过了类型检查、lint 和纯函数测试，没有在浏览器里跑过。涉及
`apps/web/src/components/nano/NanoStudio.tsx`、`NanoTaskHistory.tsx`、`contract.ts`。逐条验证：

1. 首次加载：有上次任务时能恢复并继续轮询；没有时不报错。
2. 旧键 `nexty:nano:last-task-id:v1` 在加载后被删除。
3. 账号 A 填了提示词和参考图后退出，再用账号 B 登录同一标签页：表单是空的，不出现 404 错误提示。
4. 同一用户切换到团队工作区再切回：两边各自记住自己的上次任务，历史列表随之切换。
5. 提交后、响应返回前切换工作区：返回的任务不显示，也不写入新身份的键。
6. unknown 状态的文案和按钮文字在中、英、日三种语言下显示正常。

- **验收**：六条各给出通过或失败和截图。失败就报告，不要顺手改。
- 没有浏览器能力的节点不要接这张卡，也不要用读代码代替。

### T3 release gate 加入 `auth` profile

- **原因**：gate 只要求 `minimal`、`auth_credits`、`nano_payments`，只用 Auth 的产品没有被覆盖。
- **文件**：`scripts/release/lib/promote.mjs`（`REQUIRED_CHECKS`，`:3-10`）、
  `test/packages/release-artifacts.test.mjs`（`:165-167` 附近的同名清单，以及引用这些 id 的断言）。
- **要做的**：两处都加入 `{ id: "auth", kind: "profile" }`，并补齐因清单变长而需要调整的测试数据。
- **验收**：`pnpm test:packages` 全绿；缺少 `auth` 证据时 gate 判定失败，有对应用例证明。
- **注意**：先读清楚 gate 的证据是怎么生成和校验的再动手；如果加 profile 需要改证据生成脚本以外的
  发布流程，停下报告。

### T4 两条迁移链的 DDL 等价守护测试

- **原因**：应用跑 `_n2` 链（`apps/web/src/lib/db/migrations/*.sql`），包内是 `_niu` 链
  （`packages/persistence-pg/src/migrations/modules/*.ts`）。两者在共享的 16 张表上现在完全一致，
  但没有测试守护，任何一边单独加 DDL 都不会被发现。
- **要做的**：新增 `test/packages/pg-ddl-equivalence.test.mjs`，不连数据库。把两边的 SQL 按
  `--> statement-breakpoint` 切成语句并规范化空白后比较：`_niu` 的每条语句都必须出现在 `_n2` 里；
  `_n2` 多出的语句只允许涉及白名单对象。
- **白名单**：表 `posts`、`tags`、`post_tags`、`feedback`、`feedback_replies`，以及它们用到的 6 个枚举
  （`post_status`、`post_type`、`post_visibility`、`feedback_priority`、`feedback_status`、`feedback_type`）。
- **已知差异**：`_n2` 用 `ALTER TABLE "session" ADD COLUMN "impersonated_by"` 追加该列，`_niu` 把它
  内联在 `CREATE TABLE "session"` 里。测试要显式处理这一条，不要靠放宽比较规则绕过。
- **验收**：测试通过；临时往任一边加一条 DDL 时测试失败（在交接里说明做过这个变异并已还原）。

### T5 修正过期的 `legacy-reference`

- **原因**：`packages/persistence-pg/legacy-reference/README.md` 自称是
  `apps/web/src/lib/db/migrations/` 的逐字节冻结副本，但应用目录已经有 `0002_nano.sql`，
  `meta/_journal.json` 也不同了。这个目录会随包发布（`package.json` 的 `files`）。
- **要做的**：只改 README，写明它是“截至 0001 的冻结副本”，不含 `0002_nano`，并说明 `_journal.json`
  的哈希对应的是冻结时的版本。不要往里补文件，也不要改已有文件的字节。
- **验收**：README 里列的每个 SHA256 与目录内文件实际一致（用 `sha256sum` 核对并贴出）。

### T6 文档口径修正（属于主控写集，需主控授权后再做）

下列各处与当前代码不符，都是纯文档改动：

| 文件 | 问题 | 改成 |
| --- | --- | --- |
| `docs/agent-review-loop.md` | 写领域参考库是 `nexty_overnight_20261105_test` | `test/domain/helpers.ts:13` 实际要求 `nexty_overnight_20261105_n4_app`，并需要 `DOMAIN_TEST_EXPECTED_DATABASE`、`DOMAIN_TEST_EXPECTED_PORT` |
| 同上 | 写“未注入连接变量时 PG 用例只 skip” | `test:domain` 缺变量时是 fail；auth 相关用例还需要 `BETTER_AUTH_SECRET` |
| 同上 | 没提代理环境下 `test:engineering` 要用离线模式 | 补上通用规则里那段做法 |
| `docs/migrations-canonical.md` | 只讲 `_n2`，读者会以为只有一条链 | 开头加一句指向 `docs/platform-architecture.md` §6 的 `_niu` 链 |
| `docs/platform-architecture.md` §6 | “启动兼容检查是只读的”读起来像应用已接入 | 补一句：参考应用当前用 `_n2` 链，没有在启动时调用任何兼容检查 |
| `apps/web/scripts/check-db-compat.ts:4` | 注释写“two canonical identities” | 现在是三份迁移 |
| `TODO.md` 第 1 项 | 写“按 userId 隔离” | 已在本分支按 subject 实现，改为已完成并指向 T2 的浏览器验证 |

### T7 连接建立前的网络失败改判为确定失败

- **原因**：`packages/feature-nano/src/provider/google.ts:54-60` 把所有非 4xx 都判为 unknown。
  DNS 解析失败、连接被拒、TLS 握手失败这类错误发生时请求根本没发出去，可以立即退款，
  不必等 15 分钟的超时。
- **难点**：要先弄清 `@google/genai@1.43.0` 在这些情况下实际抛出什么。不要凭猜测写判断条件。
- **要做的**：
  1. 用仓库已有的内存传输夹具（`test/fixtures/nano/`）或一个指向本机未监听端口的 `baseUrl`，
     实测并记录各类失败的错误对象形态（`name`、`code`、`cause.code`）。不调用真实 Google。
  2. 只把**能证明请求未发出**的错误码判为 `unknown: false`，建议白名单起步：`ENOTFOUND`、
     `EAI_AGAIN`、`ECONNREFUSED`。`ECONNRESET`、超时、任何 5xx 都**不在**其中。
  3. 在 `test/packages/nano-provider.test.mjs` 为白名单内外各补用例。
- **验收**：白名单内的错误走失败并退款，其余行为与现在完全一致；现有 provider 用例不改仍为绿。
- **拿不准就不做**：判错的代价是用户拿到退款而平台被计费，宁可留在 unknown 由超时兜底。

## 需要用户先决策，暂时不要做

| 事项 | 卡在哪 |
| --- | --- |
| provider 返回 5xx 且未收到任何流内容时，是否算确定失败 | 取决于 provider 对 5xx 是否计费，仓库里查不到 |
| 输入图和结果图的保留期 | 合规和产品口径。现状是永久留在 `nano_tasks` 行里 |
| 团队工作区内成员能否互相查看、取消任务 | 产品口径。现状是可以 |
| 结果图迁出 PG 行、改存对象存储 | 等保留期定了再做；读取投影已经先缓解了热路径 |

## 明确不做

- 不拆独立 Worker。部署是长驻 Node 进程，进程内 sweeper 够用。
- 不为 unknown 做管理员人工处置页面和审计表。已按用户决定采用超时自动退款。
- 不新增 `AuthSeatPolicy` 接口。静态 billing 端口已经满足“有组织、无计费”。
- `_n2` 到 `_niu` 的接管、`persistence-pg` 内部依赖改 optional peer、统一生命周期容器：
  等出现具体触发条件再立项。
