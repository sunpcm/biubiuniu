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
