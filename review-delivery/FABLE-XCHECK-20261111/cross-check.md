# Nexty 平台架构交叉复核（FABLE-XCHECK-20261111）

> 角色：独立交叉复核节点。本文不是批准结论，由主控核验。
> 本文所有 `file:line` 以 `ae5ae2cf9f10fe2bb5fc1969215ff8aee9ccbb3e` 为准。

## 1. 实际模型与基线核对

| 项 | 期望 | 实际 |
| --- | --- | --- |
| `configured_model` | Fable 5.2 | `claude-fable-5-2` |
| `session_context.model` | Fable 5.2 | `claude-fable-5-2` |
| `external_metadata.last_served_model` | Fable 5.2 | `claude-fable-5-2`（开工时读取；会话中途若发生回退不会反映在这里） |
| `git rev-parse HEAD` | `ae5ae2c…` | `ae5ae2cf9f10fe2bb5fc1969215ff8aee9ccbb3e` |
| `git status --short --branch` | 干净 | 干净，跟踪 `origin/codex/nexty-platform-overnight-20261105` |
| Node | v24.15.0 | 宿主自带 v22.23.4；从 nodejs.org 下载官方 v24.15.0，SHA256 校验通过后经 PATH 前缀使用 |
| pnpm | 10.26.0 | 仓库内 10.26.0 |

上一轮交付分支 `claude/fable-architecture-review-20261110`：`065ebcf..de7c43e` 之间只新增了
`fable-cross-check-handoff.md`（97 行），与交接说明一致。

与仓库规则的冲突说明：

- `AGENTS.md` 规定实施节点不能自行 `commit`、`push`。本轮交接说明明确授权把
  `review-delivery/FABLE-XCHECK-20261111/` 提交并 push 到 `claude/fable-cross-check-20261111`。
  我按这条当次授权执行，范围只有这一个目录、这一个分支，没有碰产品写集。
- `docs/agent-review-loop.md` 规定 PG 验证用主控指定的隔离库和角色。本轮自建的
  `fable_probe_*` 库只是补充证据，不属于那套标准隔离库，仓库自带 PG 用例一律记为未执行。

## 2. 独立判断（第一步）

本节在**阅读上一轮 `architecture-second-opinion.md` 和 `evidence/` 之前**写成并单独提交，
提交顺序可在分支历史里核对。当时只读过交接说明里 C1–C9 的一句话描述。

### 结论一览

| 声明 | 判断 | 一句话 |
| --- | --- | --- |
| C1 | 成立（有一处细化） | `unknown` 不释放 active job，也没有退款和人工出口；只存在一条“同进程晚到成功”的窄出口 |
| C2 | 成立 | 停机只清定时器，Next 的退出流程不等派发；在途任务最终落入 C1 |
| C3 | 成立 | 应用只跑 `_n2` 链；`_niu` 链只有测试在用；共享的 16 张表实测等价，但两套 journal 互不相认 |
| C4 | 部分成立 | “任意组合都是 7 个”说过头了；实质问题成立；组织强制的是 billing **端口**；gate 确实漏了 `auth` |
| C5 | 成立 | 而且比声明更重：每次状态推进的 `RETURNING` 也带回整行 |
| C6 | 成立 | 品牌名被写进 `nano_tasks.product_id` 和幂等唯一索引，改名会让存量任务静默失联 |
| C7 | 成立（低危） | 服务端有归属校验，不泄露数据；后果是旧键 404 |
| C8 | 部分成立 | 四种写法和无 `closeDatabase` 属实；“缓存失败”属实但只会缓存确定性错误 |
| C9 | 成立（有前提） | 前提是部署形态为长驻 Node 进程；serverless 下结论要变 |

### C1 — 成立，有一处细化

代码事实：

- `transitionToUnknown` 更新状态后直接返回，不调用 `deleteActiveJob`
  （`packages/persistence-pg/src/nano/index.ts:223-236`）；另外三个终态转换都调用了
  （同文件 `:189`、`:208`、`:219`）。
- `nano_active_jobs.user_id` / `organization_id` 为 `ON DELETE RESTRICT`
  （`packages/persistence-pg/src/schema/nano.ts:103-107`，
  `apps/web/src/lib/db/migrations/0002_nano.sql:46-47`）。
- `markUnknown` 不退款（`packages/feature-nano/src/core.ts:334-345`）。
- 从 `unknown` 出去的路径逐条核对：
  - `failed`：`transitionToFailed` 没有 claim 就返回 `null`（`nano/index.ts:194`）。唯一带 claim
    的调用点是 `dispatchOne` 的 `catch`，它在 `markUnknown` 和 `fail` 之间二选一
    （`apps/web/src/lib/nano/dispatch.ts:60-70`），不会在 `unknown` 之后再 `fail`。
  - `canceled`：只允许从 `queued`（`nano/index.ts:216`）。
  - `succeeded`：无 claim 时要求 `result_ref IS NOT NULL`（`nano/index.ts:179`）。
- 全仓搜 `coordinator.fail|cancel|complete|markUnknown`，生产代码里只有
  `dispatch.ts` 和 `cancel/route.ts`，没有管理端、CLI 或脚本入口。
- 用户删除前置检查不看 Nano：Better Auth 的 `beforeDelete`
  （`packages/auth/src/factory.ts:328-349`）和管理员 `deleteUserAccount`
  （`apps/web/src/actions/users/admin.ts:565-646`，实际删除在 `:640`）都只查组织归属和订阅。
  组织删除的 `beforeDeleteOrganization` 同样只查订阅和账单历史
  （`packages/auth/src/organization.ts:120-135`）。

细化（声明里没有的）：

- 存在一条从 `unknown` 到 `succeeded` 的代码路径。`STAGEABLE_STATUSES` 含 `unknown`
  （`nano/index.ts:66`），所以“lease 在 provider 调用期间过期 → 被 stale sweep 标成 unknown →
  同一进程里 provider 调用随后成功返回”时，`stageResult` + `complete` 仍会用原 claim 收尾
  （`dispatch.ts:73-81`）。这条路只救“晚到的成功”，对 provider 报错进入的 unknown 和进程已死的
  unknown 都无效。所以“没有入口”应读作“没有对账或人工入口”。
- 个人任务的 active job 只挂 `user_id`，组织任务只挂 `organization_id`
  （`apps/web/src/lib/nano/identity.ts:23-37`）。组织任务卡住时挡的是组织删除，不挡发起人的账号删除。
- 界面把 `unknown` 当作轮询终点（`apps/web/src/components/nano/NanoStudio.tsx:583`），并给了一个
  “manualConfirm” 按钮，但它只是重新拉取任务（`NanoStudio.tsx:721-730`），后端没有对应的确认动作。

推断：FK 违例会以数据库原始错误冒出来（管理员路径落到 `admin.ts:643-645` 的通用 `catch`），
用户看到的不是“有进行中的任务”这类可操作的提示。运行时表现留给第三步探针验证。

### C2 — 成立

- `stop()` 只 `clearInterval`（`apps/web/src/lib/nano/runtime.ts:92-97`），信号处理只调它
  （`apps/web/src/lib/nano/bootstrap.ts:71-73`）。没有任何地方持有或等待进行中的 `runOnce()`。
- Next 16.3.3 的 `start-server` 清理流程是：`server.close` → `nextServer.close()` →
  `process.exit(143)`（`node_modules/.pnpm/next@16.3.3_*/node_modules/next/dist/server/lib/start-server.js:321-380`）。
  它等的是 HTTP 连接，不是进程内派发的 Promise。
- 被杀时处于 `dispatching`/`running` 的任务，lease 到期后被 `listStaleInFlight`
  （`nano/index.ts:275-290`）扫到，由 `sweepStaleInFlight` 标成 `unknown`（`dispatch.ts:119-133`）。

细化：

- 只处于 `leased`、还没进 `dispatching` 的任务会被重新派发，是安全的（`core.ts:217-219`）。
- 默认 provider 超时 120 秒、lease 180 秒（`apps/web/src/config/nano.ts:49`、`:61`）。一次生成
  持续多久，暴露窗口就有多长，所以**每次发布或重启都可能把在途任务送进 C1 的永久状态**。
  C2 本身只是触发器，损失由 C1 决定。

### C3 — 成立

- 应用 CLI 只走 `_n2` 链：`apps/web/scripts/migrate.ts:1,12` →
  `apps/web/src/lib/db/migration-runner.ts:9`（`_n2_migration_journal`），源是
  `apps/web/src/lib/db/migrations/` 下三份 SQL。
- 包内链写的是 `_niu_migration_journal` / `_niu_migration_profile`
  （`packages/persistence-pg/src/migrations/runner.ts:12-13`）。全仓搜
  `checkProfileCompatibility` 和包内 `runMigrations`，调用方只有
  `test/packages/pg-profiles-pg.test.mjs` 和 `pg-profiles.test.mjs`。
- 应用自己的只读兼容检查 `apps/web/scripts/check-db-compat.ts` 没有接到任何 `package.json`
  script 或启动路径（全仓只有 `docs/modules/db-assembly.md:45` 提到它）。它的注释还写着
  “two canonical identities”（`check-db-compat.ts:4`），而现在是三份迁移。

DDL 是否等价（实测，不是读文本）：把两条链分别应用到两个空的 PG 16 库，再对
`pg_dump --schema-only` 做 diff，结果在 `evidence/ddl-n2-vs-niu.schema.diff`。

- `_niu` 链（`nano_payments` 全闭包）产出 16 张表，`_n2` 链产出 21 张。
- diff 里**没有任何只出现在 `_niu` 一侧的行**：16 张共享表的列、默认值、约束、索引和枚举完全一致。
- `_n2` 多出的 5 张表是应用自有的 `posts`、`tags`、`post_tags`、`feedback`、`feedback_replies`，
  外加 6 个枚举。
- 两条链都会把同一个外键名截断到 63 字符，截断结果相同。

所以物理结构在共享子集上等价，但**账本不等价**：`_n2` 建的库在 `_niu` 检查里是“全部缺失”
（`runner.ts:317-321`），反过来也一样（`migration-runner.ts:190-193`）；在已有表的库上跑另一条链会
撞 `CREATE TYPE` / `CREATE TABLE` 已存在。代码里没有接管或基线化路径。我也没找到守护
“两份 DDL 保持一致”的测试，现在的一致靠的是人工同步。

### C4 — 部分成立

安装闭包：

- `persistence-pg` 强依赖 `auth`、`commerce`、`contracts`、`feature-nano`
  （`packages/persistence-pg/package.json`）；`feature-nano` 依赖 `commerce`；`next` peer 依赖 `auth`。
- 因此用到 `persistence-pg` 的产品至少装 5 个内部包；再加 `db` 和 `next` 是 7 个，这正是参考应用
  的 Next + PG 形态。
- “任意组合都是 7 个”不准确：不用 `next` 或自带连接的产品是 5–6 个；只用 `auth` 核心、自带 store
  的产品是 1 个。
- 实质问题成立：只要 Auth 的产品在 PG 上也会装进 `commerce` 和 `feature-nano` 的代码。不过
  `stripe`、`creem`、`@google/genai` 都是可选 peer，`persistence-pg/auth` 子入口运行时只引
  `niu-auth` 类型和 auth schema（`packages/persistence-pg/src/auth/index.ts:8-11`）。代价主要是
  **版本和发布节奏被绑在一起**，不是体积或运行时加载。

组织对 billing 的强制：

- 成立：`organization` 能力没有 billing 端口就抛错（`packages/auth/src/factory.ts:132-134`），
  组织插件无条件调用它（`packages/auth/src/organization.ts:20-25`、`:120-122`）。
- 但强制的是 `AuthBillingPort` 这个**端口**，不是 Commerce 包或账单表。Auth-only 产品可以注入一个
  返回常量的桩。PG policy store 的补偿同理需要 `billingQueries`
  （`packages/persistence-pg/src/auth/index.ts:51-58`），也能用桩。
- 真正缺的是一个现成的“无计费席位策略”，现在每个这样的产品都得自己手写桩。

release gate：

- 成立。`REQUIRED_CHECKS` 只有 `minimal`、`auth_credits`、`nano_payments` 三个 profile
  （`scripts/release/lib/promote.mjs:3-10`；`test/packages/release-artifacts.test.mjs:165-167`
  与之一致）。`auth` profile 只在 `pg-profiles-pg.test.mjs:130` 有用例，那要注入 PG 变量才跑，
  不在 gate 里。

### C5 — 成立，且比声明更重

- 输入图以 base64 存进 `input_ref` jsonb（`apps/web/src/lib/nano/admit.ts:60-64` →
  `schema/nano.ts:63-67`），上限 5 MiB 原图（`apps/web/src/config/nano.ts:102`），base64 后约 6.7 MB。
- 结果图以 base64 JSON 存进 `result_ref` text（`apps/web/src/lib/nano/dto.ts:77-91` → `schema/nano.ts:61`）。
- `listBySubject` 用无参 `.select()` 读整行（`nano/index.ts:312`），而列表 DTO 把这些字段全扔了
  （`dto.ts:121-129`）。一页最多 50 行（`apps/web/src/app/api/nano/tasks/route.ts:15`）。

声明没提到的：

- 状态轮询 `GET /tasks/:id` 和取图路由每次都 `loadById` 整行（`nano/index.ts:166`）；取图路由每取一张
  图就解析一遍整个结果 JSON（`result/[index]/route.ts:22-40`）。
- 每次状态推进都是 `UPDATE … RETURNING` 整行（`markLeased`、`markDispatching`、`stageResult` 等），
  一个任务从入队到完成，输入图要在 PG 和 Node 之间来回五六次。
- `listStaleInFlight`、`listStaged` 也读整行（`nano/index.ts:277`、`:294`），而它们只需要 id。
- 没有任何代码在终态后清掉 `input_ref`（全仓搜 `inputRef` 只有写入和派发读取），用户上传的图会
  永久留在行里。这是存储问题，也是数据留存问题。

### C6 — 成立

- `productId: options.productId ?? siteConfig.name`（`apps/web/src/composition/commerce.ts:123`），
  `siteConfig.name` 是 `"BiuBiuNiu"`（`apps/web/src/config/site.ts:16`）；Nano 直接沿用
  （`apps/web/src/composition/nano.ts:50`）。
- 这个值被持久化到 `nano_tasks.product_id` 和 `nano_case_selections.product_id`，并且是幂等唯一索引
  的一部分（`schema/nano.ts:80-85`）；仓储的所有读、写、扫描都按它过滤（`nano/index.ts:98`）。
- Commerce 侧只在内存里校验非空（`packages/commerce/src/index.ts:23`），不落库。

推断：改品牌名（或改大小写、加空格）之后，存量任务对新进程全部不可见：排队的不再派发，在途的
不再被 stale sweep 收敛，active job 留着继续挡删除，而且没有任何报错。

### C7 — 成立，低危

- `await admit(payload)` 之后直接写状态和 localStorage，没有核对会话是否还是提交时那个
  （`apps/web/src/components/nano/NanoStudio.tsx:505-517`）。
- 键是全局常量（`apps/web/src/components/nano/contract.ts:10`）。恢复逻辑只在 `sessionUserId`
  变化时重跑（`NanoStudio.tsx:310-312`）。
- 服务端每个读写入口都按 `productId` + `subjectKey` 校验归属
  （`apps/web/src/app/api/nano/tasks/[taskId]/route.ts:18-27`），所以不泄露数据，后果是 404 和错误提示。

我自己的补充：服务端的归属单位是 subject（`org:<id>` 或 `user:<id>`），不是 userId。同一个用户
切换工作区后，`sessionUserId` 不变，但旧键指向的任务属于另一个 subject，同样会 404。客户端会话里
拿得到 `activeOrganizationId`（`apps/web/src/components/shared/WorkspaceSwitcher.tsx:55-57`），
所以按 subject 分键在客户端是可行的。只按 userId 分键修不掉切工作区这个场景。

### C8 — 部分成立

四种写法属实：

1. import 时即建的单例：`apps/web/src/lib/db/index.ts:19`（`composition/db.ts:135-149`）。
2. import 时即建的模块常量：`apps/web/src/lib/auth/index.ts:130`、`:137`。
3. 惰性缓存 Promise：`composition/commerce.ts:162-169`、`composition/nano.ts:66-70`。
4. 显式生命周期对象加一次性启动 Promise：`lib/nano/runtime.ts:83-97`、`lib/nano/bootstrap.ts:35`、`:51`。

“惰性 Promise 会缓存失败”在写法上属实（三处都是 `??=`，没有失败后重置）。但这些工厂体内
**没有 I/O**，能抛的只有确定性错误：lease 不大于超时（`apps/web/src/config/nano.ts:92-97`）、
productId 不一致、Commerce 构造校验。重试也只会再失败一次，所以缓存失败在这里等同于 fail-closed。
而且 `instrumentation.ts:5` 是 `await` 的，配置错误会在启动时就暴露。我把它评为 P2 的代码卫生问题，
不是可用性风险。将来如果有人往这些工厂里加 I/O，这条才会变成真问题。

“生产没有 `closeDatabase`”属实：全仓生产代码没有调用方，只有测试在用。实际影响有限，进程退出时
连接由操作系统回收，未提交事务由 PG 回滚。它只有在要做优雅停机（C2）时才需要一起补。

### C9 — 成立，有前提

同意现在不拆独立 Worker，理由：

- 当前最痛的两件事（C1 的对账出口、C2 的停机排空）都能在进程内解决，拆 Worker 一件也不会自动修好。
- 派发的正确性已经靠数据库 CAS 加 claim token 保证，不依赖“只有一个进程”。
- 拆出去要新增部署单元、健康检查和发布编排，而平台目标是让第二个产品尽快能装配。

前提：`composition/db.ts:21-28` 专门识别了 Vercel、Netlify、Lambda，但 `setInterval` 式的 sweeper
（`runtime.ts:83-90`）需要长驻 Node 进程。**如果实际部署在 serverless 上**，任务只在实例温热时才会
被派发和收敛，那时该做的也不是独立 Worker，而是由定时触发器调用一个 sweep 入口。实际部署形态我从
仓库里读不出来，需要用户确认（见第 5 节）。

重新评估拆分的触发条件：需要跨实例的全局并发配额；单任务耗时超过平台请求或实例寿命；或者 Nano
的发布节奏需要和 Web 解耦。

## 3. 与上一轮的对照（第二步）

对照对象：`origin/claude/fable-architecture-review-20261110` 上的
`review-delivery/FABLE-ARCH-20261110/architecture-second-opinion.md` 和 `evidence/`（内容以 `065ebcf` 为准）。
下文称“上一轮”。每条标注类型：**代码事实**、**执行事实**（本轮实际运行）、**推断**、**偏好**。

### 3.0 对第一步的自我更正

对照之后，我在第 2 节有三处要更正。第 2 节保持原样不改，以保留“先独立判断”的顺序。

1. **C1 的出口我少数了一条。** 我写了“`dispatchOne` 不会在 `unknown` 之后再 `fail`”，这不对。
   lease 在 provider 调用期间过期、任务被 stale sweep 标成 `unknown` 之后，如果 provider 随后返回确定性
   4xx，`dispatch.ts:70` 的 `coordinator.fail(task.id, claim)` 仍会成功并退款，因为
   `TERMINAL_FROM_STATUSES` 含 `unknown` 且 lease 字段没被清掉。上一轮的 C1-c 是对的，本轮探针也复现了。
2. **C6 我漏了 Commerce 的去重键。** 我写“Commerce 侧只在内存里校验”。上一轮指出去重和告警 claim 键
   以 `productId` 作前缀，属实（`packages/commerce/src/duplicate.ts:24`、
   `packages/commerce/src/notify.ts:17`）。
3. **C7 我漏了表单不清空。** 换号时重置逻辑不清 `prompt`、`upload`、`selectedCaseId`
   （`NanoStudio.tsx:315-319`），上一个账号的提示词和参考图会留给下一个人。这是上一轮发现的，属实，
   而且是 C7 里唯一涉及内容外泄的一点。

### 3.1 我同意的结论

| 上一轮结论 | 类型 | 我的核对 |
| --- | --- | --- |
| P0 为空 | 推断 | 同意。CAS、claim 和退款唯一约束挡住了重复退款和重复交付；我没有找到越权或多扣的路径 |
| C2 成立；只“等扫描结束”不够；应用要接管停机顺序需设 `NEXT_MANUAL_SIG_HANDLE` | 代码事实 | 同意，`start-server.js:387-390` 属实 |
| M1：非 4xx 一律归为 unknown | 代码事实 | 同意，见 3.5 |
| C3：没有测试守护两条链等价；`legacy-reference` 已过期且会随包发布 | 代码事实 + 执行事实 | 同意。我用另一种方法（真实建库后 diff `pg_dump`）得到同样的结果；两份 `_journal.json` 的 SHA256 我重新算过，确实不同；`files` 含 `legacy-reference` 属实（`packages/persistence-pg/package.json:41-46`） |
| C4：第三方依赖不膨胀，代价在版本牵连；gate 漏 `auth` | 代码事实 | 同意 |
| C5：输入图无限期保留 | 代码事实 | 同意，我独立得到同样结论 |
| C6：修复时取值必须保持 `"BiuBiuNiu"` | 推断 | 同意，这是这条修复里最容易踩的坑 |
| C7：应按 subject 而不是 userId 隔离 | 代码事实 | 同意，见 3.5 |
| C8 补充：`lib/db` 在 import 时捕获 `db`，`closeDatabase()` 后重建的池没人用 | 代码事实 | 同意（`apps/web/src/lib/db/index.ts:19-21`） |
| C9：现在不拆 Worker；serverless 是触发条件之一 | 推断 | 同意 |
| M2：批内一个 `dispatchOne` 抛错会让并发上限失守 | 推断 | 同意。补一点：同一次 tick 里 `sweepStaged` 和 `sweepStaleInFlight` 也会被跳过（`runtime.ts:69-78`） |
| M3：干净 checkout 直接 typecheck 失败 | 执行事实 | 复现：退出码 2，TS2307；`build:packages` 之后 11/11 |
| M4：engineering 测试不透传代理变量 | 代码事实 + 执行事实 | 代码属实（`test/engineering.test.mjs:44-71`）。在线模式我没有重跑（原因见第 6 节）；预热后离线 4/4 |
| M5、M6、M7、M9 | 代码事实 | 同意。`markRunning` 在 `apps/web/src` 确实没有调用方 |
| K1–K5“保持不动” | 偏好 | 同意 |

### 3.2 我不同意的结论

**D-1（P1，代码事实）C1 应判“成立”，不是“部分成立”。**

上一轮因为“原进程持有 claim 时有出口”而把 C1 降为部分成立。这两条出口在代码里确实存在，但在仓库
自己强制的配置下**走不到**：

- 任务要先被 stale sweep 标成 `unknown`，provider 调用才可能“迟到”，这要求一次调用的时长超过 lease。
- 配置加载时强制 lease 大于 provider 超时，否则直接抛错（`apps/web/src/config/nano.ts:92-97`）。
- SDK 的超时是一个不会被清除的 `setTimeout(() => abortController.abort(), timeout)`
  （`@google/genai@1.43.0` 的 `dist/node/index.mjs:12097-12107`），流式读取期间同样生效。所以调用最迟在
  超时点被中止，早于 lease 到期。
- 另一类 unknown 来自 provider 报错（`dispatch.ts:60-62`），那时调用已经结束，同一进程不会再有后续动作。

所以上一轮探针的 C1-b 和 C1-c 证明的是“仓储层允许”，不是“生产路径会发生”。探针里的 lease 是手工设的
500 毫秒，`markUnknown` 是手工调的。按默认配置，**unknown 在应用里就是永久状态**，原声明成立。
（SDK 那部分是我读已安装依赖得出的，没有用真实调用验证。）

**D-2（P2，执行事实）C1 里“组织无法删除”这一半不是 Nano 造成的增量损害。**

上一轮和我的第一步都把“组织被 RESTRICT 挡住”算作 C1 的后果。补充探针 X1 显示，删除组织时先触发的是
`credit_transactions_organization_id_organization_id_fk`，不是 Nano 的外键。原因：

- 组织只要有一条积分流水就属于“有账单历史”，应用层本来就拒绝删除
  （`packages/persistence-pg/src/commerce/index.ts:196-201`，`packages/auth/src/organization.ts:129-134`）。
- Nano 任务受理时必然产生一条扣费流水（`core.ts:247-253`）。

因此组织只要跑过任何一个 Nano 任务，无论成功失败，按现有设计就已经永久不可删。真正的增量损害只在
**个人用户**这一侧：`credit_transactions.user_id` 是 `SET NULL`，个人账号的删除只被 `nano_active_jobs` 挡住。

**D-3（P2，代码事实）C3 判“部分成立”偏严，但实质无分歧。**

上一轮因为 `_n2` 链多出 CMS 和反馈表而说“DDL 等价严格不成立”。原声明问的是“是否等价”，答案应该是：
共享的 16 张表完全等价，`_n2` 是它的超集。我们在事实上一致，只是对同一事实的标签不同。

**D-4（P2，代码事实）C4“任何组合都是 7 个包”仍然说过头，“要改两个接缝”也说过头。**

- 上一轮加了“只要使用 PG 适配器”的限定，但 7 个里的 `next` 和 `db` 不是 `persistence-pg` 带来的。
  不用 Next 或自带连接的产品是 5 或 6 个。
- “有组织、无计费需要同时改 core 和 PG 两处”不成立。两处都是端口，消费者今天就能各注入一个返回常量
  的对象，不用改任何包，见 3.6。

**D-5（P2，代码事实）C5“列投影只需收窄到 `listBySubject` 和 `listStaleInFlight`”漏了最热的路径。**

- 前端轮询默认每秒一次（`packages/feature-nano/src/react.ts:212-224`），每次都 `loadById` 整行
  （`nano/index.ts:166`）。
- 每次状态推进的 `RETURNING` 也是整行。
- 补充探针 X2 实测：一张 5 MiB 输入图的任务，单次列表、单次轮询、单次 `markLeased` 各拉回约 6.99 MB，
  投影查询是 161 字节。一次 60 秒的生成，光轮询就要从 PG 读约 400 MB。

`listDispatchable` 需要整行这一点我同意。

**D-6（P2，代码事实）M10 的影响被夸大了一处。**

外键名被截断属实，我在两条链上都看到了同一条 NOTICE。但上一轮说“只读兼容检查会对不上”不成立：
`checkProfileCompatibility` 只核对 journal、哨兵表和哨兵列，不看约束名（`runner.ts:361-379`）。
受影响的只有 drizzle-kit 比对和将来按名字 `DROP CONSTRAINT` 的迁移。

**D-7（P2，代码事实）设计稿一内部自相矛盾。**

§3.1.2 把“不退款”也映射到 `failed`，而 §4.1 又建议把 `failed` 的用户文案改成“任务失败，{cost} 积分
已退回”。两者同时落地，“不退款”的任务会对用户显示已退回。要么 `failed` 一律退款（不提供“不退款”），
要么文案不能承诺退回。

**D-8（P2，执行事实）上一轮有 13 处 `file:line` 行号超出文件长度。**

`evidence/cite-check.py` 机械核对了上一轮正文里能唯一解析到文件的 96 处行号引用，结果见
`evidence/cite-check-output.txt`：

- `apps/web/src/lib/nano/dispatch.ts`：7 处（文件只有 134 行，引用到了 243）。这 7 处统一偏了 +109，
  正好是 `runtime.ts` 的行数，应该是把几个文件拼在一起看时用了连续行号。例如 `:229-243` 实际是 `:120-134`。
- `apps/web/src/lib/nano/identity.ts`：4 处（文件 38 行，引用 `:105-111`、`:105-119`）。按内容对应，实际是 `:23-29`、`:23-37`。
- `apps/web/src/app/api/nano/tasks/[taskId]/cancel/route.ts`：2 处（文件 40 行，引用 `:49-60`、`:66`）。
  按内容对应，实际是 `:17-28`、`:34`。

这些引用指向的**内容都是对的**，只是行号不可用。主控核验上一轮时请按本文的行号。脚本只检查行号是否
越界，不检查没越界的行号是否指对了地方；写成 `nano/index.ts:65` 这类不带完整路径的引用也不在统计内。

**D-9（偏好）“失败后清空缓存的 Promise”不值得提前到“现在做”。**

理由见第 2 节 C8：这些工厂里没有 I/O，重试只会得到同一个确定性错误。改了无害，但不解决任何现有问题。

### 3.3 我认为上一轮遗漏的问题

| # | 等级 | 类型 | 问题 | 依据 |
| --- | --- | --- | --- | --- |
| X-1 | P1 | 代码事实 | unknown 的两条“同 claim 出口”在强制配置下不可达，见 D-1。这直接改变了 C1 的裁定和修复的紧迫度 | D-1 |
| X-2 | P1 | 代码事实 + 执行事实 | **用户无法靠重试自救。** unknown 之后用同一个 `requestKey` 重放，拿回的是同一个 unknown 任务，不新建也不退款（`core.ts:240-245`；探针 X3）。界面上“再次确认”按钮只是重新拉取。用户唯一能做的是换一个 key 再付一次 | X3 |
| X-3 | P2 | 执行事实 | 组织的不可删除来自积分流水，不来自 Nano，见 D-2 | X1 |
| X-4 | P2 | 代码事实 + 执行事实 | 轮询和 `RETURNING` 才是整行读取的热路径，见 D-5 | X2 |
| X-5 | P2 | 代码事实 | 任务变成 unknown 时**没有任何日志或计数**。`dispatch.ts:60-66` 静默处理；`runtime.ts:75-78` 只在整次 sweep 抛错时记一个固定 code。现在无法从日志回答“线上有多少 unknown” | 同左 |
| X-6 | P2 | 代码事实 | M1 可以先缩小入口。连接建立前就失败的网络错误（DNS 解析失败、连接被拒、TLS 握手失败）请求根本没发出去，却同样被判 unknown（`google.ts:54-60`）。这一类可以安全地判为确定失败并立即退款 | 同左 |
| X-7 | P2 | 代码事实 | 应用自己的只读兼容检查 `check-db-compat.ts` 没有接到任何 script 或启动路径，注释还写着“two canonical identities”。上一轮只说了 `_niu` 的检查没接入，没提 `_n2` 自己的也没接 | 第 2 节 C3 |
| X-8 | P2 | 代码事实 | 设计稿一的矛盾，见 D-7 | D-7 |
| X-9 | — | 执行事实 | 上一轮探针的 C2 段没有运行 Next，也没有运行 `runtime.ts`。子进程里的 `process.exit(143)` 是脚本自己写的（`probe-c1-c2-unknown.mjs:61-64`）。它证明的是“进程在 dispatching 时退出后数据层会怎样”，“Next 不等派发”这一半靠的是读 `start-server.js`。两者都成立，但证据等级不同，上一轮正文写成了“复现（已执行）” | 探针源码 |

### 3.4 排序与建议的意见

P0：无（与上一轮一致）。

P1 只有一条链，我建议把上一轮并列的 C1、C2、M1 合成一件事来排：

1. **先给 unknown 一个会自动走完的出口**（见 3.6 的最小改法）。它一旦存在，C2 和 M1 产生的 unknown 都会
   在有限时间内退款并释放 active job，剩下的只是“用户多等一会儿”。
2. **再做优雅停机**。它只减少 unknown 的数量，不解决已经产生的。
3. **再缩小 M1 的入口**（X-6，以及是否把 5xx 判为确定失败，见第 5 节 U2）。

上一轮建议“先上线观测和只读管理员列表”。观测我同意（X-5），但只读列表**不退一分钱、不解锁一个账号**，
排在自动出口之前会让最实际的损害继续存在。

P2 里我建议调整两处：

- **C6 现在就做。** 它只是把一个默认值换成同值的常量，加一条断言。第二个产品一旦照着样板装配，品牌名
  当产品 ID 的做法就会被复制出去，之后再改要迁移数据。
- **C5 的轮询投影现在就做。** 给轮询和列表用一个不含 `input_ref`、`result_ref` 的查询，不动 schema。
  这比把图片搬到对象存储（上一轮 T5）小得多，而且收益立刻可见。

其余 P2（C3 接管、C4 的 optional peer、C7、C8 统一生命周期）我同意上一轮“触发后再做”的安排。

### 3.5 重点核对项

**M1（provider 的 5xx、网络错误、超时都归为 unknown）——成立。**

- `classifyProviderError` 只把数值状态 400–499 判为确定失败，其余全部 `unknown: true`
  （`packages/feature-nano/src/provider/google.ts:54-60`）。
- 流已经开始后再失败，固定 `unknown: true`（`google.ts:125-131`）。
- 超时走的是 abort，没有数值状态，落进 unknown。429 属于 4xx，会判失败并退款。
- 结论：即使 C2 完全修好，provider 抖动也会持续制造 unknown。这类服务“过载返回 503”并不罕见，所以
  unknown 是常态产物。上一轮这条判断我完全同意。

**M10（外键名超长被截断）——成立，影响比上一轮写的小。** 见 D-6。本轮在三个库上各看到一次同样的
NOTICE 42622。

**C7“应按 subject 而不是 userId 隔离”——成立。** 我在第一步独立得到同一结论，依据见第 2 节 C7。
补充：上一轮建议键名用 `v2:<subjectKey>`、遇到 v1 旧键直接删除、404 时静默清键，我都同意。这也意味着
`TODO.md` 第 1 项的表述（“按 userId 隔离”）需要主控改口径，否则实施者会照字面做出一个修不掉切工作区
场景的版本。

### 3.6 两份设计稿是否可行，有没有更小的改法

**设计稿一（unknown 对账）——可行，但首版可以小得多。**

可行性核对：

- `resolveUnknown` 的 CAS 条件、清 lease、删 active job、同事务退款，和现有 `fail` 的事务边界一致
  （`nano/index.ts:518-526`），能实现。
- 退款有唯一约束兜底，重复执行不会多退。
- 与迟到结果的竞争：终态之后 `stageResult` 的状态条件不再匹配，迟到结果会被丢弃。这一点设计稿说对了。
- 问题：D-7 的文案矛盾；A2 新表要在两条链上各加一次（C3）；管理员页面、乐观并发、审计表加起来是一个
  中等规模的功能。

更小的改法（推断，未实现、未验证）：

1. 在现有 sweeper 里加第四步 `sweepExpiredUnknown`：`status = 'unknown' AND result_ref IS NULL AND
   updated_at < now - N` 的任务，走一次不带 claim 的“失败并退款”。仓储层只需要一个新方法，CAS 条件与
   设计稿的 `resolveUnknown` 相同，并清掉 lease。
2. 审计先用退款流水的 `note`（设计稿的 A1）。因为这条路径**只退款**，A1“不退款无处留痕”的缺点不存在。
3. 不做管理员页面、不加表、不加 cron 路由、不新增 enum。变更集中在 `core.ts`、`nano/index.ts`、
   `dispatch.ts`、`runtime.ts` 四个文件加测试。
4. 同时在任务进入 unknown 和被自动退款时各打一条结构化日志（X-5）。

为什么自动退款不会被薅：退款之后迟到的结果会被丢弃，用户拿不到图，所以没有“既退款又拿到结果”的路径。
平台承担的最坏情况是 provider 实际生成并计费了、而用户拿到了退款，损失是一次生成的成本。

这个改法的前提是业务接受“超时一律退款”（第 5 节 U1），以及部署形态是长驻进程（U3）。管理员人工处置
和“不退款”选项可以等有真实需求再加。

**设计稿二（AuthSeatPolicy）——可行，但不需要新接口。**

- 形态一（只用 Auth、不开组织）：`billing: null` 和 `billingQueries: null` 都是已支持的输入
  （`packages/auth/src/types.ts:104-105`，`packages/persistence-pg/src/auth/index.ts:37-43`）。
  读代码看是可行的；对应的两条 PG 用例本轮被 skip，**未验证**。
- 形态二（开组织、无计费）：设计稿新增 `AuthSeatPolicy` 和 `AuthOrganizationDeletionPolicy` 两个接口，
  并把 `OrganizationPluginDeps.billing` 拆成两个字段。这要改动付费产品正在使用的席位校验和补偿路径。

更小的改法：`AuthBillingPort` 本身已经是端口，只有三个方法。导出一个现成的静态实现即可：

```ts
// packages/auth：不改 factory.ts / organization.ts
export function createStaticBillingPort(opts: { seats: number }): AuthBillingPort {
  return {
    getOrgSeatCap: async () => ({ seats: opts.seats, hasTeamSubscription: true }),
    hasLivePersonalSubscription: async () => false,
    getOrganizationDeletionBlockers: async () => ({ hasTeamSubscription: false, hasBillingHistory: false }),
  };
}
// packages/persistence-pg/auth：同理导出一个只实现 getOrgSeatCap 的静态 AuthPgBillingQueries
```

- 现有产品的代码路径一行不动，回归面是零。
- 消费者甚至今天就能自己写这十几行，不需要等平台发版。
- 代价是名字不好看：一个无计费产品要传一个叫 `billing` 的东西。这是命名偏好，我认为不值得为它动核心
  路径。等出现第二种真实的席位语义（比如按套餐但不走 Commerce）再抽 `AuthSeatPolicy` 也不迟。

设计稿里“gate 加 `auth` profile”和“补一个 auth-only 消费者 fixture”我都同意，这两件与用哪种接口无关。

## 4. 探针复跑结果（第三步）

环境：本会话 scratchpad 里自建的临时 PostgreSQL 16.15 集群，只监听 `127.0.0.1:55432`，trust 认证；
每次运行用一个新建的空库，库名都以 `fable_probe_` 开头。全部跑完后已 `pg_ctl stop`，`pg_isready` 确认
无响应。完整输出见 `evidence/probe-rerun-output.md`。

**这些只算补充证据。** 它们不是 `docs/agent-review-loop.md` 规定的标准隔离库，仓库自带的 PG 用例一条
也没有因此变成“通过”。

运行前核对：我通读了 `probe-c1-c2-unknown.mjs` 全部 191 行。它只连接 `FABLE_PROBE_PG_URL`；库名不以
`fable_probe_` 开头、与期望值不一致、或者库非空，都会在任何写入之前退出；只插入合成用户和合成任务；
不调用任何外部服务。复制到本交付目录的副本与上一轮文件 SHA256 相同。

| 运行 | 库 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 上一轮探针原样复跑 | `fable_probe_xcheck_c1c2` | 0 | C1a、C1b、C1c、C2 四段全部通过，输出与上一轮记录一致 |
| 补充探针，第一次 | `fable_probe_xcheck_extra` | 0 | X2、X3 通过；X1 我的断言预期错了（见下），脚本记为“未完成” |
| 补充探针，改后重跑 | `fable_probe_xcheck_extra2` | 0 | X1、X2、X3 全部完成 |
| 两条迁移链建库对比 | `fable_probe_ddl_n2`、`fable_probe_ddl_niu` | psql 全部 0；diff 为 1（有差异） | 见第 2 节 C3 |

补充探针 `probe-xcheck-extra.mjs` 的三段：

- **X1**：组织任务卡在 unknown 后删除组织，报 23503，先触发的是
  `credit_transactions_organization_id_organization_id_fk`。指向 `organization` 且会拒绝删除的外键共三条：
  `credit_transactions`、`nano_active_jobs`、`subscriptions`。发起人账号可以删除。
  第一次运行时我断言先触发的是 Nano 的外键，这个预期是错的；改成记录实际约束名后重跑。它就是 D-2 的来源。
- **X2**：5 MiB 输入图（base64 后 6,990,508 字节）的任务，`listBySubject` 单行约 6.99 MB，`get` 约
  6.99 MB，`markLeased` 的返回约 6.99 MB；只取五个字段的投影查询 161 字节。本机回环上单次约 35–45 毫秒，
  这个耗时不代表真实网络环境。
- **X3**：unknown 之后用同一 `requestKey` 重放，`created=false`，返回同一个 unknown 任务，余额不变。

探针能证明什么、不能证明什么：

- 能证明：仓储层和迁移 DDL 在真实 PG 上的行为，与读代码得出的结论一致。
- 不能证明：Next 的停机行为（没有运行 Next）、真实 provider 的错误形态（没有调用）、应用层 sweeper 的
  定时行为（没有运行 `runtime.ts`）。这三项的依据仍然是读代码。

## 5. 需要用户决策的事项

| # | 决策 | 选项 | 我的推荐 |
| --- | --- | --- | --- |
| U1 | unknown 的处置策略 | a 超时自动退款，首版不做人工入口（3.6 的最小改法）<br>b 人工逐条处置（上一轮 S1）<br>c 两者都做（上一轮 S4）<br>d 维持现状 | **a**。它是唯一能在不加表、不加页面的前提下同时解决“未退款”和“账号删不掉”的选项。需要你定超时时长 N；N 必须大于 lease（默认 180 秒），其余是业务口径，我不替你定 |
| U2 | provider 返回 5xx 且尚未收到任何流内容时，算确定失败（立即退款）还是继续算 unknown | a 算确定失败<br>b 维持 unknown | 取决于 provider 对 5xx 是否计费，这在仓库里查不到，需要你按合同或账单确认。连接建立前的网络失败（X-6）我建议直接判确定失败，这条不依赖业务口径 |
| U3 | 实际部署形态 | a 长驻 Node 进程（`next start`、容器）<br>b serverless（Vercel、Netlify、Lambda） | 需要你告知。是 b 的话，进程内 sweeper 不可靠，U1 的方案要改成由定时触发器调用，C9 的结论也要重看 |
| U4 | 第二个产品是否需要“有组织、无计费” | a 不需要，按形态一交付<br>b 需要，用静态 billing 端口（3.6）<br>c 需要，按上一轮设计新增 `AuthSeatPolicy` | 有真实需求再做；要做选 **b** |
| U5 | 上一轮的 D3（图片保留期）和 D4（组织成员能否互相查看、取消任务） | 见上一轮 §6 | 这两项是合规和产品口径，我没有新信息，维持“待定” |
| U6 | `TODO.md` 第 1 项是否改为“按 subject 隔离，并在换号时清空表单” | a 改<br>b 维持“按 userId” | **a**（见 3.5）。`TODO.md` 属于主控写集，我没有改 |

## 6. 执行记录

运行时：除特别注明外，均为 Node v24.15.0（scratchpad 内官方二进制，SHA256 已校验）和 pnpm 10.26.0。
全部检查串行执行，期间没有其他 writer。

### 6.1 已运行的命令

| # | 命令 | 退出码 | 摘要 |
| --- | --- | --- | --- |
| 1 | `get_session`（session_id 省略） | — | 三个模型字段都是 `claude-fable-5-2` |
| 2 | `git status --short --branch`；`git rev-parse HEAD`；`git fetch origin <两个分支>` | 0 | HEAD 为 `ae5ae2c…`，工作树干净。会话启动时已在目标分支的目标提交上，所以没有再执行 `git checkout -B` |
| 3 | `node --version`；`pnpm --version`（宿主自带） | 0 | v22.23.4 / 10.26.0 |
| 4 | 下载 `node-v24.15.0-linux-x64.tar.xz` 和 `SHASUMS256.txt`，`sha256sum -c` | 0 | 校验通过 |
| 5 | `HUSKY=0 pnpm install --frozen-lockfile` | 0 | 11.7 秒 |
| 6 | 临时 PG：`initdb`、`pg_ctl start`（127.0.0.1:55432） | 0 | PostgreSQL 16.15 |
| 7 | `pnpm exec tsx ddl-dump-modules.mts <dir>`（当时脚本在 scratchpad，`evidence/` 里是同一份文件）；psql 依次执行两条链的 SQL；`pg_dump --schema-only`；`diff` | 0 / 0 / 0 / 1 | diff 有差异是预期结果；只在 `_n2` 一侧 351 行，只在 `_niu` 一侧 0 行 |
| 8 | `git checkout -b claude/fable-cross-check-20261111`；提交第一步（`388d679`） | 0 | 此时尚未读上一轮结论 |
| 9 | `python3 -I evidence/cite-check.py <repo> <上一轮主文档>` | 0 | 96 处行号引用，13 处越界 |
| 10 | `pnpm exec turbo run typecheck`（未先 build） | **2** | `@sunpcm/niu-feature-nano` 报 TS2307，6/9 |
| 11 | `pnpm build:packages` | 0 | 9/9 |
| 12 | `node evidence/probe-c1-c2-unknown.mjs`（库 `fable_probe_xcheck_c1c2`） | 0 | 四段全部通过 |
| 13 | `node evidence/probe-xcheck-extra.mjs`（库 `fable_probe_xcheck_extra`） | 0 | X1 断言预期错误，记为未完成 |
| 14 | 同上，改后（库 `fable_probe_xcheck_extra2`） | 0 | 三段全部完成 |
| 15 | `pg_ctl stop`；`pg_isready` | 0；2（无响应） | 集群已停。第一次 `pg_ctl stop` 退出码 1：scratchpad 上层目录的权限被重置成 700，postgres 用户进不去；恢复遍历权限后成功，随后把该目录改回 700 |
| 16 | `pnpm exec turbo run typecheck` | 0 | 11/11 |
| 17 | `pnpm test:packages`（含 `build:packages`、`check:boundaries`） | 0 | 179 项：171 通过 / 0 失败 / **8 skip**。8 项都因缺 PG 变量被跳过，**记为未验证**，清单见 `evidence/check-log-summary.md`。`violations: []`、`missingDist: []` |
| 18 | `pnpm test:routing` | 0 | 4/4 |
| 19 | 在 scratchpad 预热 pnpm store（只装 `prettier@3.8.0` 和 `prettier-plugin-tailwindcss@0.7.2`） | 0 | 不涉及仓库文件 |
| 20 | `ENGINEERING_TEST_SCRATCH_ROOT=… ENGINEERING_PNPM_INSTALL_MODE=offline ENGINEERING_PNPM_STORE_DIR=… pnpm test:engineering` | 0 | 4/4。**偏离默认在线模式**，已记录 |
| 21 | 各阶段后 `git status --short` | 0 | 只有本交付目录是新增内容 |

### 6.2 未运行的项及原因

| 项 | 原因 |
| --- | --- |
| `pnpm test:domain` | 不在本轮允许的检查清单内（它依赖 PG 变量）。上一轮记录的“缺变量时 fail 而不是 skip”（M8）我**没有复现**，只确认了 `test/domain/helpers.ts:108` 用的是 `requireEnv("DATABASE_URL")` |
| `pnpm test:engineering` 默认在线模式 | 上一轮记录它在代理环境下会挂起。这组测试包含源码变异，中途强杀可能留下被改动的产品文件，所以我没有为了复现挂起去冒这个险。代码层面的原因已核实（`commandEnv` 不透传代理变量） |
| 仓库全部 PG 用例 | 需要标准隔离库、角色和变量。自建集群没有冒充这些身份 |
| Web lint、build | 与本轮结论无关；默认构建内存问题属于 `TODO.md` 第 3 项 |
| 浏览器、截图、登录态 | 没有做。上一轮 §4 的前端逻辑评审里，我只核对了与 C7 和 unknown 相关的部分，§4.5 可访问性等内容**没有逐条复核** |
| 上一轮 §5.3 K3（`packages/db/src` 旧 schema）和 §5.4 文档重叠 | 没有逐条复核，只按阅读印象表示同意 |
| 真实 AI、支付、SSO、registry | 被禁止 |

### 6.3 外部依赖状态

| 依赖 | 状态 |
| --- | --- |
| npm registry（经宿主代理） | 可达；用于冻结安装和预热 store |
| nodejs.org | 可达；只用于下载 Node 24.15.0 |
| 真实 Google GenAI / Stripe / Creem / PayPal / SSO / 私有 registry | 没有调用 |
| PostgreSQL | 宿主没有注入。只连接过本会话自建集群里的 `fable_probe_*` 库，用完已停 |
| 真实 `.env`、凭据 | 没有读取 |

### 6.4 交付状态分项

| 项 | 状态 |
| --- | --- |
| 本地静态检查 | typecheck 11/11（需先 build）；`check:boundaries` 无违例 |
| 本地测试 | `test:packages` 171 通过 / 8 skip；`test:routing` 4/4；`test:engineering` 4/4（离线模式）。`test:domain` 未运行 |
| 独立 Review | 未进行。本文是交叉复核意见，等主控核验 |
| 外部依赖 | 全部未验 |
| 提交 | 只提交 `review-delivery/FABLE-XCHECK-20261111/`，分支 `claude/fable-cross-check-20261111`，从 `ae5ae2c` 创建 |
| push | 只 push 上述分支。不开 PR，不合并 |
| 部署 | 无 |

### 6.5 证据文件

| 文件 | 内容 |
| --- | --- |
| `evidence/probe-c1-c2-unknown.mjs` | 上一轮探针的逐字节副本 |
| `evidence/probe-xcheck-extra.mjs` | 本轮补充探针（X1–X3） |
| `evidence/probe-rerun-output.md` | 三次探针运行和建库对比的输出 |
| `evidence/ddl-dump-modules.mts` | 导出 `_niu` 四个模块 SQL 的脚本 |
| `evidence/ddl-n2-vs-niu.schema.diff` | 两条链建库后的 `pg_dump` diff |
| `evidence/cite-check.py`、`cite-check-output.txt` | 上一轮行号引用的越界检查 |
| `evidence/check-log-summary.md` | skip 清单和 typecheck 失败摘录 |
