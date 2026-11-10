# Nexty 平台架构复核与设计（第二意见）

> 本文是架构复核与设计节点的交付，不是批准结论。最终评审由 Codex 负责；本文中的任何“成立”“建议”都不代表交付已被批准，也不批准本文自身。

## 1. 实际模型与基线核对

### 1.1 实际模型

- 用户指定模型：Fable 5.2。
- **实际服务模型：`claude-opus-5-5`**。本会话用 `get_session` 读到 `configured_model`、`session_context.model`、`external_metadata.last_served_model` 都是 `claude-opus-5-5`。宿主没有提供 Fable 5.2；按任务要求如实记录，没有自行切换。

### 1.2 基线核对

| 项 | 期望 | 实际 | 结论 |
| --- | --- | --- | --- |
| 开发分支 HEAD | `ae5ae2cf9f10fe2bb5fc1969215ff8aee9ccbb3e` | 同左 | 一致 |
| 工作树 | 干净 | `## codex/nexty-platform-overnight-20261105...origin/...`，无改动 | 一致 |
| 宿主自带 Node | v24.15.0 | v22.23.4 | 不一致，只记录 |
| 用于执行检查的 Node | v24.15.0 | 从 nodejs.org 下载官方 v24.15.0 到会话 scratchpad，SHA256 与 `SHASUMS256.txt` 校验一致；只通过 `PATH` 前缀使用，不改仓库 | 一致 |
| pnpm | 10.26.0 | 10.26.0 | 一致 |

### 1.3 与仓库规则的关系

- `AGENTS.md`“实施与评审”一节规定实施节点不能自行 commit 或 push。本轮用户在任务中明确授权：只把 `review-delivery/FABLE-ARCH-20261110/` 提交并 push 到新分支 `claude/fable-architecture-review-20261110`。按 `AGENTS.md` 中“当次具体授权”的条款执行，提交范围只有这一个目录。
- 云端会话的系统设定曾给出另一条默认分支名 `claude/vigilant-gates-hgtdma`。用户明确指定了新分支名，本文以用户指定为准，没有向那条分支推送。
- `TODO.md` 规定产品待办暂停。本轮没有修改任何产品代码、测试、依赖、锁文件、配置或既有文档。

### 1.4 证据口径

- **代码事实**：本轮亲自读到的源码，行号以 `ae5ae2c` 为准。
- **执行事实**：本轮实际运行的命令，退出码见 §7。
- **推断**：由代码路径推出、但没有运行验证的结论。
- **偏好**：工程取舍，不是缺陷。

历史数字（448/448、22/22 等）一律不作为当前结论引用。

---

## 2. 任务 1：C1–C9 独立复核

### 2.1 裁定总表

| 编号 | 裁定 | 一句话 | 等级 |
| --- | --- | --- | --- |
| C1 | **部分成立** | 不删 active job、RESTRICT 都成立，而且是有意设计；“完全没有出口”不成立：原进程仍持有 claim 时可以走到终态，但进程一旦丢失就确实没有出口。“积分冻结”的说法不准确：积分已经扣除，只是没有退款 | P1 |
| C2 | **成立** | `next start` 收到 SIGTERM 后只等 HTTP 请求结束就 `process.exit(143)`，进程内派发不在等待范围内；单纯“等待进行中扫描”也不足以解决 | P1 |
| C3 | **部分成立** | 双链并存、包内 runner 只被测试使用、文档与应用不一致，这几点都成立；“DDL 等价”在严格意义上不成立：`_n2` 链多出 CMS 和反馈表；`legacy-reference` 也已经过期 | P2 |
| C4 | **成立（并补充）** | 7 个包的闭包与 release gate 缺口都成立；另外 PG policy store 也强制要求 billing 查询，所以“有组织、无计费”需要改两个接缝，不是一个 | P2 |
| C5 | **成立（并补充）** | 另有输入图片无限期保留的隐私问题；`listDispatchable` 读取整行是必要的，不属于浪费 | P2 |
| C6 | **成立（并补充）** | 另外 Commerce 的 Redis 去重键也以 `productId` 作前缀；改名还会让用户历史整体消失 | P2 |
| C7 | **成立（代码路径），未复现** | 另发现两点：同一用户切换工作区不会重置；退出或换号后，上一个账号的提示词和图片仍留在表单里 | P2 |
| C8 | **成立（并补充）** | `lib/db` 在 import 时捕获了 `db`，`closeDatabase()` 之后重建的新连接池不会被已有消费者使用 | P2 |
| C9 | **同意（判断）** | 补充了触发条件 | — |

### 2.2 逐条依据

#### C1 Nano `unknown` 出口与 active job

**代码事实**

- `transitionToSucceeded`、`transitionToFailed`、`transitionToCanceled` 在 CAS 成功后都会调用 `deleteActiveJob`（`packages/persistence-pg/src/nano/index.ts:189`、`:208`、`:219`）；`transitionToUnknown` 不删（`:223-236`）。
- `nano_active_jobs` 的 user 外键和 organization 外键都是 `ON DELETE restrict`（`packages/persistence-pg/src/migrations/modules/nano.ts:67`、`:69`）。模块注释说明这是有意设计：“a refundable task cannot be orphaned by account/org deletion”（`:7-9`）。测试也把它当作合同来断言：unknown 后 active job 仍在（`test/domain/nano-restart.test.ts:236-241`），RESTRICT 会阻止删除账号（`test/domain/nano-pg-coordinator.test.ts:427`）。
- **存在一个出口（上一轮漏看了）**：`TERMINAL_FROM_STATUSES` 包含 `unknown`（`nano/index.ts:65`），`STAGEABLE_STATUSES` 也包含 `unknown`（`:66`），而且 `transitionToUnknown` 不清除 `lease_owner` 和 `lease_token`。所以原派发者仍持有 claim 时：
  - 迟到的结果可以 `stageResult`，再 `complete(claim)`，状态变成 succeeded，active job 被删除；
  - 迟到的确定性 4xx 可以 `fail(claim)`，状态变成 failed，退款，active job 被删除。

  核心测试 `a late valid result stages and finalizes an unknown task held by the same claim` 本轮执行通过（见 `evidence/test-log-summary.md`）。
- **没有 claim 时不存在出口**：`transitionToFailed` 在没有 claim 时直接返回 null（`:194`）；`transitionToSucceeded` 在没有 claim 时要求 `result_ref IS NOT NULL`（`:179`）；`transitionToCanceled` 只接受 `queued`（`:216`）；`listStaleInFlight` 只扫描 `dispatching` 和 `running`（`:282`），不会再次选中 `unknown`；`dispatchDecision` 对 `unknown` 返回 skip（`packages/feature-nano/src/core.ts:215`）。全仓 grep 没有任何 admin、cron 或 API 入口处理 `unknown`。
- **主体范围**：组织工作区下 subject 是 `{ userId: null, organizationId }`（`apps/web/src/lib/nano/identity.ts:105-111`），`insertActiveJob` 照原样写入（`nano/index.ts:156-161`）。所以组织任务卡在 unknown 时只阻止删除组织，不阻止删除成员账号；个人任务则阻止删除该用户。
- **“积分冻结”不准确**：admit 时已在同一事务中 `spendCredits`（`core.ts:247-253`），余额已经减少。unknown 不会自动退款（`docs/platform-architecture.md` §5 第 4 条），因此准确说法是“已扣费、未退款、且无法自助处理”。

**推断**：进程丢失（C2）或 provider 返回 5xx、网络错误、超时（见 §2.3 M1）之后，unknown 在应用层是永久状态，用户或组织的删除会一直被 RESTRICT 拦住。

**复现（已执行，补充证据）**：`evidence/probe-c1-c2-unknown.mjs`。经用户授权，在本容器自建的临时 PG 16.15 集群上执行，退出码 0，输出见 `evidence/probe-c1-c2-output.md`。该库不是宿主注入的标准隔离库，所以只算补充证据，正式 PG 验收仍由主控代跑（见 §7.2）。覆盖四个场景：C1-a 进程丢失后 unknown 保留 active job、余额 2→1、`DELETE user` 报 23503、无 claim 的 fail/complete/cancel 全部被拒；C1-b 同一 claim 的迟到结果走到 succeeded；C1-c 同一 claim 的 fail 走到 failed 并退款；C2 见下一条。脚本有身份 guard，要求连接的库名以 `fable_probe_` 开头且为空库，否则直接退出。四个场景首次运行全部通过，代码事实与断言一致。

#### C2 SIGTERM 与优雅停机

**代码事实**

- `bootstrap.ts:71-73` 在 SIGTERM/SIGINT 时只调用 `controller.stop()`；`runtime.ts:92-97` 的 `stop()` 只 `clearInterval`，不等待 `runOnce` 中正在进行的 `sweepDispatchable`（`runtime.ts:66-81`），也不关闭连接池。
- **Next 侧（本轮读了已安装依赖）**：`next@16.3.3` 的 `dist/server/lib/start-server.js:330-390` 在 SIGTERM 时先 `server.close()` 等待 HTTP 请求结束，再执行 `nextServer.close()`，然后 `process.exit(143)`。进程内的 Nano 派发不是 HTTP 请求，不在等待范围内，会被直接终止。该文件只有在没有设置 `NEXT_MANUAL_SIG_HANDLE` 时才注册这个处理器（`:387-390`）。
- 默认 lease 是 180 秒（`apps/web/src/config/nano.ts:61`），provider 超时是 120 秒（`:49`），且配置要求 lease 大于超时（`:92-97`）。被终止的任务停在 `dispatching`，lease 到期后由任一实例的 `sweepStaleInFlight` 标记为 unknown（`apps/web/src/lib/nano/dispatch.ts:229-243`）。

**对上一轮建议的修正（推断）**：仅仅“等待进行中的扫描”不够，因为一次 provider 调用最长可达 120 秒，通常会超过编排器给的终止宽限期（具体宽限期取决于部署平台，本仓库里没有定义）。可行的做法是：

1. SIGTERM 时立刻停止领取新任务，不再调用 `markLeased`；
2. 在宽限期内尽量等待在途调用完成；
3. 宽限期到时仍未完成的任务接受会变成 unknown，并记录可观测的计数；
4. 关闭连接池。

若要由应用接管停机顺序，需要设置 `NEXT_MANUAL_SIG_HANDLE`，否则 Next 的 `process.exit` 会先执行。

**复现（已执行）**：`probe-c1-c2-unknown.mjs` 的 C2 段。子进程按 `dispatch.ts:154-167` 的顺序推进到 `dispatching`，然后挂起 provider；父进程发送 SIGTERM。子进程复用 Next 的 `exit(143)` 语义，退出后断言行停在 `dispatching`；lease 到期后被扫成 unknown，积分未退。实测子进程退出码 143，行停在 `dispatching`，随后被扫成 `unknown`，余额 2→1 未退。

#### C3 两条迁移链

**代码事实**

- 产品 CLI 使用 `_n2_migration_journal`（`apps/web/src/lib/db/migration-runner.ts:9`、`apps/web/scripts/migrate.ts:12`）。包内 runner 使用 `_niu_migration_journal` 和 `_niu_migration_profile`（`packages/persistence-pg/src/migrations/runner.ts:12-13`）。
- 全仓 grep 结果：`checkProfileCompatibility` 只出现在 `test/packages/pg-profiles-pg.test.mjs`；`apps/web/src/instrumentation.ts:1-11` 启动时只做 Sentry 和 Nano 初始化，不做兼容检查。`docs/platform-architecture.md` §6 写“启动兼容检查是只读的”，它描述的是包的能力，但参考应用并没有接入，确实容易让人误解。
- **DDL 对比（执行事实，`evidence/ddl-compare-output.txt`）**：对两条链按语句归一化后比较：
  - 应用链共 114 条语句，模块链共 82 条；
  - 只在应用链出现的有 `posts`、`tags`、`post_tags`、`feedback`、`feedback_replies` 五张表、6 个 enum 以及它们的外键和索引，另有 `session.impersonated_by` 用 `ALTER` 追加；
  - 模块链把 `impersonated_by` 内联进了 `CREATE TABLE "session"`；
  - 其余业务表（Auth、Payments、Credits、Nano）的语句完全一致。

  结论是“业务部分等价”，不是“DDL 等价”。接管时 CMS 和反馈表必须继续由应用自己维护。
- **`legacy-reference` 已过期**：`packages/persistence-pg/legacy-reference/README.md` 称其是 `apps/web/src/lib/db/migrations/` 的“byte-for-byte frozen copy”。但应用目录已有 `0002_nano.sql` 和 `0002_snapshot.json`，`_journal.json` 的 SHA256 是 `eb511d68…`，而 legacy 副本只有 0000/0001，`_journal.json` 是 `b04b4031…`（本轮 `sha256sum` 实测）。这个目录会随 `files` 一起发布（`persistence-pg/package.json:43`）。
- 没有任何测试守护两条链的等价关系，这一点成立。

#### C4 安装闭包与 release gate

**代码事实**

- `persistence-pg` 的 dependencies 是 `auth`、`commerce`、`contracts`、`feature-nano`（`packages/persistence-pg/package.json:52-57`）；`feature-nano` 依赖 `commerce`；`next` 以 peer 方式依赖 `auth`；`db` 没有内部依赖。所以只要使用 PG 适配器，任何组合的内部闭包都是 `auth`、`next`、`db`、`persistence-pg`、`commerce`、`contracts`、`feature-nano` 这 7 个包。
- 第三方依赖不会因此膨胀：`commerce` 的 stripe/creem 和 `feature-nano` 的 `@google/genai`/react 都是 optional peer（本轮读取各包 `package.json`）。成本主要在精确版本牵连，这一点成立。
- `factory.ts:132-134` 在开启 organization 而没有 billing 时直接抛错。
- **补充**：PG policy store 自身也要求 billing 查询：`createAuthPolicyStore` 在 `billingQueries` 为 null 时，`reclaim*` 会抛出 “Seat compensation requires a billing query port”（`packages/persistence-pg/src/auth/index.ts:50-57`）。所以“有组织、无计费”需要同时改 core 的 `AuthBillingPort` 检查和 PG 的 `AuthPgBillingQueries`。
- release gate 只要求 `minimal`、`auth_credits`、`nano_payments` 三个 profile（`scripts/release/lib/promote.mjs:3-7`；测试 `test/packages/release-artifacts.test.mjs:164-171`），确实没有覆盖 `auth` profile。`auth` profile 会创建 organization、member、invitation 表（`migrations/modules/auth.ts`）。现有测试 `auth-only PG: Teams endpoints unregistered when organization is not selected` 表明当前合同是“仅 Auth = 无组织”。这条测试本轮因缺少 PG 变量被 skip。

#### C5 base64 存储与整行读取

**代码事实**

- 结果 base64 序列化后写进 `result_ref`（`apps/web/src/lib/nano/dto.ts:77-91`）。输入 base64 写进 `input_ref.imageData`（`apps/web/src/lib/nano/admit.ts:60-64`），单张最大 5 MiB（`config/nano.ts:102`）。
- `listBySubject` 用 `select()` 读取整行（`nano/index.ts:309-327`），而列表 DTO 只用 id、status、cost 和时间字段（`dto.ts:121-129`），列表路由逐行映射（`apps/web/src/app/api/nano/tasks/route.ts:45-53`）。
- `listStaleInFlight` 也读取整行（`nano/index.ts:275-290`），但调用方只用 `task.id`（`dispatch.ts:236-238`）。
- **修正**：`listDispatchable` 读取整行是必要的，因为派发要用 `inputRef.prompt` 和 `inputRef.imageData`（`dispatch.ts:162-166`）。`listStaged` 也需要 `resultRef`（`dispatch.ts:216-219`）。
- **补充**：`api/cron` 下只有 `credits`，没有 Nano 的保留或清理任务。任务进入终态后，输入图片仍然无限期留在 PG 里。这属于隐私和保留策略问题，需要业务决策（见 §6 D3）。

#### C6 `productId`

**代码事实**

- `productId` 取 `options.productId ?? siteConfig.name`（`apps/web/src/composition/commerce.ts:123`），其中 `siteConfig.name = "BiuBiuNiu"`（`apps/web/src/config/site.ts:16`）。
- Nano 的所有查询都按 product 过滤（`nano/index.ts:98`）。任务详情和取消路由会比对 `task.productId !== runtime.productId`（`api/nano/tasks/[taskId]/route.ts:18-22`）。
- **补充**：Commerce 的去重和通知 claim 键以 `productId` 作前缀（`packages/commerce/src/duplicate.ts:24`、`packages/commerce/src/notify.ts:17`）。

**推断**：改了品牌名之后，已有任务会同时从扫描、用户历史和详情里消失；它们的 active job 仍在，账号删除继续被拦住；进行中的去重窗口也会被重置。

**注意**：修复时“稳定 PRODUCT_ID”的取值必须保持现值 `"BiuBiuNiu"`，否则修复本身就会触发同样的问题。

#### C7 `NanoStudio` 会话归属

**代码事实**

- `submit` 在 `await admit(payload)`（`apps/web/src/components/nano/NanoStudio.tsx:505`）之后，直接 `setSelectedTaskId`、写全局键、`refreshTask`、`watch`（`:507-517`），没有核对当前会话用户是否还是发起时的那位。
- 本地键是全局常量 `nexty:nano:last-task-id:v1`（`contract.ts:10`）。恢复逻辑对任何登录用户都读取同一个键（`NanoStudio.tsx:321-331`），所以换号后会触发 404 并显示错误。

**补充（推断，未复现）**

1. 重置逻辑只依赖 `sessionUserId`（`NanoStudio.tsx:311`），历史列表同样只依赖它（`NanoTaskHistory.tsx:100-113`）。`WorkspaceSwitcher` 切换组织时只调用 `router.refresh()`（`components/shared/WorkspaceSwitcher.tsx:66-72`），不会重新挂载客户端组件，userId 也没有变化。但服务端 subject 已经从个人变成组织（`identity.ts:105-119`），结果是：页面仍显示个人任务，点“刷新”得到 404，历史列表也是旧的。**TODO #1 提出“按 userId 隔离”还不够，应该按 subject（userId + activeOrganizationId）隔离。**
2. 重置逻辑会清空 task、selectedTaskId、lastSubmission、error 和 notice（`:315-319`），但不清空 `prompt`、`upload`、`selectedCaseId`。在共享设备上换号后，B 会看到 A 的参考图和提示词。

#### C8 生命周期写法

**代码事实**

- Auth 在 import 时构造（`apps/web/src/lib/auth/index.ts:130`、`:137-157`）。
- Commerce 和 Nano 用 `??=` 缓存 Promise（`composition/commerce.ts:162-169`、`composition/nano.ts:66-70`）。Promise 一旦 reject 会被永久缓存，后续请求都拿到同一个失败。
- `createNanoRuntime` 只接受 `caseIds` 参数（`composition/nano.ts:39-44`），db、commerce 和环境变量都在模块内部取得（`:20`、`:45-59`）。
- 全仓 grep 显示 `closeDatabase` 只在测试和 fixture 中调用。
- 扫描异常只记录固定 code `nano_sweep_failed`（`runtime.ts:75-78`）。
- **补充**：`apps/web/src/lib/db/index.ts:19-21` 在 import 时执行 `const db = database.db` 并导出；`composition/db.ts:151-160` 的注释说“A subsequent `getDatabase()` call builds a fresh pool”，但所有消费者持有的都是旧的 `db`。所以 `closeDatabase()` 只能作为进程退出前的最后一步，不能用来重连。
- **补充**：`instrumentation.ts:4-5` 会 await `startNanoRuntimeOnce()`。Nano 装配失败（例如 lease 配置非法）会让整个服务启动失败，这是 fail-fast 的有意行为，但文档里没有写。

#### C9 是否拆独立 Worker

同意现在不拆。`runtime.ts:27-28` 已明确声明只支持单实例。补充三个触发条件：

1. 需要跨实例的全局并发或配额；
2. provider 单次调用时长长期超过部署平台的终止宽限期，使 C2 的 unknown 无法通过优雅停机消除；
3. serverless 部署（instrumentation 定时器不能常驻）。

满足其中任何一条时再拆，拆法是把 `createNanoRuntimeController` 放进独立入口进程，数据合同不需要改。

### 2.3 上一轮遗漏的问题

| 编号 | 等级 | 类型 | 问题 | 依据 |
| --- | --- | --- | --- | --- |
| M1 | **P1** | 代码事实 | **unknown 是常规路径的产物，不是罕见事件**：Google provider 把所有非 4xx 都判为 unknown，包括 5xx、网络错误、超时，以及流已开始后的失败。仓库内也没有 provider 查询能力。因此即使完全解决 C2，unknown 仍会持续产生，对账出口必须成为常设能力 | `packages/feature-nano/src/provider/google.ts:10-15`、`:54-60`、`:125-131`；`core.ts:208-213`；测试 `a 5xx or lost-response failure stays unknown and is sent once` 本轮执行通过 |
| M2 | P2 | 推断 | `sweepDispatchable` 用 `Promise.all` 处理一个批次。批内任一 `dispatchOne` 抛错（例如 `coordinator.fail` 遇到数据库瞬断），`runOnce` 会进入 catch，并在 finally 中把 `sweeping` 置回 false，而批内其他 provider 调用仍在进行。下一次 tick 会开始新的派发，实际并发可能超过 `maxConcurrent` | `dispatch.ts:200-203`；`runtime.ts:66-80` |
| M3 | P2 | 执行事实 | 干净 checkout 上直接运行 `pnpm exec turbo run typecheck` 会失败（`@sunpcm/niu-feature-nano` 报 TS2307：找不到 `@sunpcm/niu-commerce`）。原因是 typecheck 的 `dependsOn` 只有 `^typecheck`，而包之间通过 dist 解析。先执行 `build:packages` 再跑就是 11/11 通过。`docs/agent-review-loop.md` 把它列为独立入口，但没有说明这个前置条件 | `turbo.json` 中 `tasks.typecheck.dependsOn`；`evidence/test-log-summary.md` |
| M4 | P2 | 执行事实 | 在代理环境中 `test:engineering` 无法在线运行：`commandEnv` 不透传 `HTTPS_PROXY` 和 CA 设置，外部消费者 `pnpm install` 会挂起（本轮观察到超过 12 分钟没有进展，手动停止）。离线模式如果事先没有 metadata 缓存，会报 `ERR_PNPM_NO_OFFLINE_META`。预热缓存后离线运行 4/4 通过 | `test/engineering.test.mjs:44-69`、`:220-236` |
| M5 | P2 | 代码事实 | `legacy-reference` 声称是逐字节冻结副本，但实际已过期（详见 C3），而且会随包一起发布 | C3 |
| M6 | P2 | 代码事实，需业务决策 | 组织工作区内，Nano 任务的 subject 是组织，**任何成员都能看到并取消其他成员的任务**，包括提示词，以及成功后的输入和结果图片 | `identity.ts:105-111`；`api/nano/tasks/[taskId]/route.ts:18-22`；`cancel/route.ts:49-60` |
| M7 | P2 | 代码事实 | `markRunning` 在应用中没有调用方，`running` 状态实际不会出现，但 UI、文案和文档都把它列为一个状态 | `grep markRunning apps/web/src` 结果为空；`dispatch.ts:157-167` 从 dispatching 直接调用 provider |
| M8 | P2 | 执行事实 | `docs/agent-review-loop.md` 说“未注入连接变量时 PG 用例只 skip”，但 `test:domain` 在缺少变量时是 **fail**（119 项失败全部是 `DATABASE_URL is not set` 或 `MIGRATION_*`），不是 skip。fail-closed 本身合理，文档口径需要修正 | `evidence/test-log-summary.md`；`docs/agent-review-loop.md` “隔离身份与 guard” 一段 |
| M10 | P2 | 执行事实 | `credits` 模块的外键名 `credit_transactions_refunded_transaction_id_credit_transactions_id_fk` 共 68 字符，超过 PG 的 63 字符上限，执行迁移时 PG 发出 NOTICE 42622，实际名称被截断为 `credit_transactions_refunded_transaction_id_credit_transactions`。两条链都用同一份 DDL，所以都会截断。任何按声明名称核对、删除或重建约束的操作（例如 drizzle-kit 比对、未来的 `DROP CONSTRAINT`、只读兼容检查）都会对不上 | `packages/persistence-pg/src/migrations/modules/credits.ts:64`；`apps/web/src/lib/db/migrations/0000_narrow_morbius.sql:278`；`evidence/probe-c1-c2-output.md`；`pg_constraint` 实查 |
| M9 | P2 | 代码事实 | 兼容路由 `gemini-image` 从内容派生 requestKey，同一用户提交完全相同的输入时只会拿回旧任务，不会新建、也不扣费。这是有意的幂等语义，但用户看不到“为什么没有生成新图” | `apps/web/src/lib/nano/admit.ts:37-44`；`api/nano/gemini-image/route.ts:4-10` |

### 2.4 排序与建议的意见

1. **上一轮把 B（unknown 对账）定为“需产品决策后再做”，偏低。** M1 说明 provider 的常规故障就会产生 unknown，而 unknown 会永久阻止删除账号。我建议把 B 提到 P1，与 A 中的“优雅停机 + 观测”并列。B 的业务策略可以后定，但**观测和只读的管理员列表**（不改 schema，不涉及资金动作）可以先做。
2. **A 中的“稳定 PRODUCT_ID”需要加保护条件**：取值必须保持 `"BiuBiuNiu"`，并加一条测试断言“默认值等于历史值”。
3. **A 中的“前端会话归属”应改为按 subject 隔离**（见 C7 补充 1），并同时清空表单（见 C7 补充 2）。
4. **C（`_n2` 到 `_niu` 的接管）可以后置**，但其中两件小事建议现在做：
   - 补一条 DDL 等价守护测试，把 `evidence/ddl-compare.py` 的逻辑改写成 `test/packages` 用例，白名单是应用自有的 CMS 和反馈表；
   - 修正或删除过期的 `legacy-reference`。

   这两件事不改 schema。
5. **A 中“列投影”的范围应收窄到 `listBySubject` 和 `listStaleInFlight`**，不要动 `listDispatchable` 和 `listStaged`。

### 2.5 本节发现按等级汇总

- **P0**：无。本轮没有发现会立即导致资金错误或越权的问题。CAS、退款唯一约束（`credit_transactions_refunded_transaction_id_unique`，`migrations/modules/credits.ts:51`）和 claim 校验都能防止重复退款或重复交付。
- **P1**：C1（unknown 没有可运维的出口）、C2（每次发布都可能制造 unknown）、M1（provider 常规故障产生 unknown）。三者叠加的结果是“已扣费、无法退款、账号无法删除”。
- **P2**：C3、C4、C5、C6、C7、C8，以及 M2–M10。

---

## 3. 任务 2：两份设计稿

### 3.1 设计稿一：Nano `unknown` 对账

#### 3.1.1 目标与约束

- 给 `unknown` 一个**可审计、幂等、权限受控**的出口，并在同一事务中释放 active job。
- 不改变现有自动路径的行为：迟到结果、迟到的确定性失败、stale 扫描都保持原样。
- 不替用户选择业务策略。下面分别列出各策略，§6 D1 汇总决策项。

#### 3.1.2 状态迁移

| 迁移 | 触发者 | 前置 CAS 条件 | 同一事务内的动作 | 说明 |
| --- | --- | --- | --- | --- |
| `unknown → failed`（**退款**） | 管理员，或自动策略 | `status='unknown' AND result_ref IS NULL AND product_id=?` | 改状态、清除 lease_owner 和 lease_token、删除 active job、`refundSpentCredits(spendTxId)`、写审计 | 复用现有 `failed` 终态，**不新增 enum 值** |
| `unknown → failed`（**不退款**，判定 provider 已消耗） | 管理员 | 同上 | 改状态、清除 lease、删除 active job、写审计（不退款） | 用户侧看到“失败”，但没有退款。是否需要区分展示见 D1 |
| `unknown → succeeded` | **只走现有自动路径** | 现有的 `stageResult` + `complete(claim)` 或无 claim 的 staged 收尾 | 现有逻辑 | 管理员**不能**手工判定成功，因为没有结果图片可以交付 |
| 已 staged 的 unknown | 现有 `sweepStaged` | `result_ref IS NOT NULL` | 现有逻辑 | 管理员入口对这类任务只读，提示“等待自动收尾” |

**为什么要清除 lease**：这样旧 owner 迟到的 `stageResult` 或 `fail` 就无法再匹配。另外，由于 CAS 要求 `status='unknown'`，即使 lease 没清，终态之后旧 owner 也推进不了；清除 lease 是第二层保护。

**为什么不新增 `refunded` 或 `abandoned` enum**：PG 的 `ALTER TYPE ... ADD VALUE` 新增的值不能在同一事务中使用，而且必须在 `_n2` 和 `_niu` 两条链上分别追加（C3），成本和风险都高于收益。区分“退款”和“不退款”交给审计记录。若业务坚持要独立状态，单独列为选项 S5。

#### 3.1.3 业务策略（不替用户选）

| 策略 | 做法 | 用户侧 | 资金风险 | 运维成本 | 实现成本 |
| --- | --- | --- | --- | --- | --- |
| S1 人工判定，默认退款 | 管理员逐条核对后选择“退款”或“不退款” | 等待时间不确定 | 最低（逐条判断） | 高，随 unknown 量线性增长（M1） | 中 |
| S2 超时自动退款 | unknown 持续超过 N 小时（N 由业务定）后，由 cron 走退款迁移 | 确定性好 | 若 provider 实际已生成并计费，平台承担那一次的 provider 成本；用户不受损 | 低 | 中（需要 cron 路由和 secret，模式同 `api/cron/credits`） |
| S3 provider 查询对账 | 按 `provider_request_key` 查询远端结果 | 最好 | 最低 | 低 | **当前不可行**：`core.ts:208-213` 已注明 Google image generation 没有查询或幂等合同。只有换 provider 或 provider 提供该能力后才能考虑 |
| S4 混合 | S2 作默认，管理员可以在超时前手工处理 | 好 | 同 S2 | 中 | S1 + S2 |
| S5 新增独立终态 | 例如 `refunded` 或 `abandoned` | 展示最清楚 | 同所选策略 | 同所选策略 | 高（需要 enum 迁移，两条链都要改） |

#### 3.1.4 接口草案（拟改目录）

**`packages/feature-nano/src/core.ts`**（纯领域，不新增依赖）

```ts
export type NanoUnknownResolution = "refund" | "no_refund";

export interface NanoResolveUnknownInput {
  taskId: string;
  resolution: NanoUnknownResolution;
  actor: { kind: "admin"; userId: string } | { kind: "policy"; policyId: string };
  reason: string;            // 非空；admin 必填，policy 写策略名
}

// NanoTaskRepository 新增一个方法（PG 与测试 fake 都要实现）
resolveUnknown(
  id: string,
  resolution: NanoUnknownResolution,
): Promise<NanoTask | null>; // CAS 失败返回 null

export async function resolveUnknownTask(
  unit: NanoUnit,
  input: NanoResolveUnknownInput,
): Promise<{ task: NanoTask; changed: boolean }>;
// 1. loadById；不存在 -> NanoTaskNotFoundError
// 2. 已终态 -> { task, changed:false }（幂等：重复点击返回当前状态）
// 3. status !== "unknown" 或 resultRef 非空 -> NanoInvalidStateError
// 4. repo.resolveUnknown CAS；null -> 重新 load 并按 2/3 处理（并发败者）
// 5. resolution==="refund" && spendTxId -> commerce.refundSpentCredits（已有唯一约束，天然幂等）
// 6. 审计写入（见 3.1.5）
```

**`packages/persistence-pg/src/nano/index.ts`**

- `resolveUnknown`：`UPDATE ... SET status='failed', lease_owner=NULL, lease_token=NULL WHERE id=? AND product_id=? AND status='unknown' AND result_ref IS NULL RETURNING *`；成功后调用 `deleteActiveJob`。
- `NanoCoordinator.resolveUnknown(input)`：沿用 `coordinatePgCommerce(store, commerce, …)`，与 `fail` 走同一种事务边界（`nano/index.ts:518-526`）。
- `listByStatus(status, cursor, limit)`：只投影 `id`、`subject_key`、`user_id`、`organization_id`、`cost`、`spend_tx_id`、`provider_request_key`、`status`、`lease_until`、`created_at`、`updated_at`，**不读取 `input_ref` 和 `result_ref`**。

**`apps/web`**

- `src/actions/nano/admin.ts`：server action，沿用 `actions/credits/admin.ts:16` 的 `getFreshSession` + `isAdmin` 写法。
  - `listUnknownNanoTasks({ cursor?, olderThanMinutes? })`
  - `resolveUnknownNanoTask({ taskId, resolution, reason, expectedUpdatedAt })`：`expectedUpdatedAt` 是乐观并发校验，防止管理员基于过期页面操作。
- `src/app/[locale]/(protected)/dashboard/admin/nano/page.tsx`：列表和处理页面（交互见 §4.4）。
- 若选 S2 或 S4：增加 `src/app/api/cron/nano-unknown/route.ts`，鉴权方式同 `api/cron/credits`。
- i18n：`Landing.json` 中补充用户侧文案；admin 文案放进 admin 命名空间。

#### 3.1.5 审计（两种落点，见 §6 D6）

| 方案 | 数据合同变化 | 内容 | 代价 |
| --- | --- | --- | --- |
| A1 只用 ledger note | **无** | 退款流水的 `note` 写 `nano-unknown-refund:<taskId>:<actorKind>:<actorId>`；“不退款”的情况没有流水可附 | “不退款”的判定**无处留痕**，除非另写应用日志（日志不是持久审计）。不满足完整审计 |
| A2 新表 `nano_task_resolutions` | **有，纯增量**：`task_id uuid PK` 引用 `nano_tasks`、`resolution text`、`actor_kind text`、`actor_id text`、`reason text`、`refund_tx_id uuid null`、`created_at` | 完整审计；`task_id` 为主键，作为幂等的第二道保护 | 两条链都要追加：`_niu` 侧新增 append-only 模块（`nano_resolutions`，依赖 `nano`，`contractVersion` 不变），`_n2` 侧新增 `0003_*.sql`。这正好可以作为 C3 等价守护测试的第一个增量用例 |

#### 3.1.6 幂等与重复点击

- 第一层是 CAS（`status='unknown'`），并发时只有一个执行者能成功。
- 第二层是退款唯一约束（`credits.ts:51`），即使逻辑出错也不会重复退款。
- 第三层（A2）是 `nano_task_resolutions.task_id` 主键。
- UI 层：按钮在提交期间禁用，服务端用 `expectedUpdatedAt` 校验；重复提交返回 `{ changed:false, task }`，HTTP 200。

#### 3.1.7 验收方式

- **单元测试**（`test/packages/nano-core.test.mjs` 的 fake repo）：
  - unknown + refund → failed，退款 1 次，active job 释放；
  - unknown + no_refund → failed，不退款；
  - 已终态任务 → `changed:false`；
  - staged（`resultRef` 非空）→ InvalidState；
  - 非 unknown → InvalidState。
- **PG 测试**（新增 `test/domain/nano-unknown-resolution.test.ts`，按 `docs/agent-review-loop.md` 的 guard 注入隔离库）：
  1. 两个并发 resolve 只退款 1 次；
  2. resolve 与迟到的 `stageResult(claim)` 竞争，最终状态唯一，余额正确；
  3. resolve 之后 `DELETE user` 成功；
  4. 非 admin 调用 action 被拒；
  5. 跨 product 无法 resolve；
  6. 若采用 A2，审计行恰好一条。
- 本文 `evidence/probe-c1-c2-unknown.mjs` 的 C1-a 场景可以直接作为“修复前红、修复后绿”的对照。

#### 3.1.8 回退方式

- 只改代码（A1）：直接 revert。已被 resolve 的任务停在 `failed`，旧代码本来就认识这个状态，余额和流水自洽。
- A2：新表是纯增量，旧代码忽略它。按 `docs/platform-architecture.md` §7，不提供 down migration；回退时保留这张表。

#### 3.1.9 停止条件

- 业务没有给出 D1/D6 的选择时，只实现“观测 + 只读列表”，不实现资金动作。
- 如果业务要求 S5（新增 enum），停下来单独立合同。
- 如果需要 S3（provider 查询），停下，等待 provider 合同。

### 3.2 设计稿二：第二消费者最小样板（只用 Auth）

#### 3.2.1 形态一：只用 Auth、不开组织（**今天就能做，不改包**）

| 项 | 内容 |
| --- | --- |
| 安装 | `@sunpcm/niu-auth`、`@sunpcm/niu-next`、`@sunpcm/niu-db`、`@sunpcm/niu-persistence-pg`，以及传递依赖 `niu-commerce`、`niu-contracts`、`niu-feature-nano`（共 7 个内部包，C4）；第三方依赖为 `better-auth`、`drizzle-orm`、`postgres`、`next`、`react`。不需要 stripe、creem、`@google/genai` |
| profile | `auth`（`runMigrations({ url, profile: "auth", guard })`，`_niu_migration_journal`） |
| composition | `composition/db.ts`：`createDatabase({ connectionString, schema })`。`composition/auth.ts`：`createAuthPolicyStore({ db, billingQueries: null })`，再 `createAuth({ …, billing: null, capabilities: { /* 不含 organization、billing */ } })` |
| 启动 | 启动时调用 `checkProfileCompatibility({ url, profile: "auth" })`，不兼容就拒绝启动。这样第二消费者从第一天起就满足 `docs/platform-architecture.md` §6 的描述 |
| 配置 | `DATABASE_URL`、`BETTER_AUTH_SECRET`（至少 32 字符）、`NEXT_PUBLIC_SITE_URL`，以及所选社交登录或邮件的变量 |
| 已有证据 | `auth-only PG: …` 两条用例存在（本轮缺少 PG 变量，被 skip，**未验证**） |

#### 3.2.2 形态二：只用 Auth、开组织、无计费（**需要一个端口**）

**接口草案**（`packages/auth/src/policy-store.ts`）：

```ts
/** 组织席位来源。计费产品由 Commerce 提供；无计费产品可用固定上限。 */
export interface AuthSeatPolicy {
  getOrgSeatCap(organizationId: string): Promise<OrgSeatCap>;
}

/** 删除组织前的拦截条件。无计费产品返回全 false。 */
export interface AuthOrganizationDeletionPolicy {
  getOrganizationDeletionBlockers(organizationId: string): Promise<OrganizationDeletionBlockers>;
}

export function createFixedSeatPolicy(seats: number): AuthSeatPolicy;            // 返回 { seats, hasTeamSubscription: true }
export function seatPolicyFromBilling(billing: AuthBillingPort): AuthSeatPolicy; // 适配现有 billing
```

**`CreateAuthDeps` 新增可选字段**：`seatPolicy?: AuthSeatPolicy`、`organizationDeletionPolicy?: AuthOrganizationDeletionPolicy`。

**`factory.ts:132-134` 的检查改为**：`organization && !billing && !seatPolicy` 时抛错，错误信息不变。

**解析规则**：`seatPolicy ?? seatPolicyFromBilling(billing)`；`organizationDeletionPolicy ?? billing ?? 全 false`。

**`organization.ts`**：`OrganizationPluginDeps.billing` 改为 `seats: AuthSeatPolicy` 与 `deletion: AuthOrganizationDeletionPolicy`（`:7-13`、`:18-25`、`:120-135`）。

**PG 侧**：`AuthPgBillingQueries` 的形状已经是 `{ getOrgSeatCap(queryable, orgId) }`（`persistence-pg/src/auth/index.ts:25-32`），不用改名。只需新增 `createFixedPgSeatSource(seats)`，它忽略 `queryable`，直接返回固定值。

**如何保证现有产品行为不变**：

- BiuBiuNiu 继续传 `billing`，不传 `seatPolicy`，解析结果就是 `seatPolicyFromBilling(billing)`，调用的函数和顺序与现在完全相同。
- 错误信息 `seatsFullMessage` 和 “Inviting members requires an active team subscription.” 仍由 `hasTeamSubscription` 决定。
- 固定策略返回 `hasTeamSubscription: true`，避免无计费产品显示“需要团队订阅”。

**数据合同**：无变化。`auth` profile 已包含 organization、member、invitation 表。

**要补的 release gate 与 fixture**：

1. 在 `scripts/release/lib/promote.mjs:3-7` 的 `REQUIRED_CHECKS` 和 `test/packages/release-artifacts.test.mjs:164-171` 的 `REQUIRED_GATE_IDS` 中加入 `["auth", "profile"]`。
2. 新增 private fixture `fixtures/consumer-auth-only/`（`pnpm-workspace.yaml` 已纳入 `fixtures/`，engineering 测试会强制它为 private），从本地 tarball 安装 7 个包，然后：
   - 在隔离合成 PG 上运行 `auth` profile，断言不存在 orders 等计费表；
   - 关闭组织时，Teams 端点不注册；
   - 开启组织并使用固定席位 2 时，第 3 个邀请返回 403，补偿后成员数正确；
   - 启动时 `checkProfileCompatibility` 返回兼容。
3. `test/packages/auth-core.test.mjs` 新增两条用例：“billing 与 seatPolicy 都缺失时抛错”“只给 seatPolicy 时可以装配”。保留全部现有断言，证明计费路径不变。

**验收**：现有 auth-core、auth-next、auth-pg、commerce-pg 测试全部不改仍为绿；新增用例为绿；`auth` profile gate 产出证据。

**回退**：新增字段都是可选的，revert 即可，消费者不受影响。

**停止条件**：

- Better Auth 组织插件在 1.4.7 中如果需要额外的表或字段，停下评估。
- 席位语义（固定上限、按套餐、无限）需要产品决定（§6 D5）。
- 第二消费者若需要 Commerce，就不再属于这份样板。

---

## 4. 任务 3：Nano 前端交互的逻辑层评审

> **限制**：本会话没有页面截图，也没有可登录的浏览器会话（没有真实 provider 和凭据，也不允许连接真实服务），所以**不做任何视觉判断**。以下只评审状态逻辑、文案和信息结构，依据是 `apps/web/src/components/nano/*`、`packages/feature-nano/src/react.ts` 和 `apps/web/src/i18n/messages/zh/Landing.json`（`Nano.ui`）。

### 4.1 各状态的提示与可执行动作

| 状态 | 现有提示（zh） | 现有动作 | 问题 | 建议 |
| --- | --- | --- | --- | --- |
| queued | 徽标“排队中”；轮询提示“任务已受理，正在等待服务端状态……” | 取消（`NanoStudio.tsx:731-739`，历史列表 `:173-183`） | 取消成功只提示“排队任务已取消。”，没有说明已退款，但 cancel 响应里带有 `refunded` 字段（`cancel/route.ts:66`） | 文案改为“已取消，{cost} 积分已退回”，以响应中的 `refunded` 为准 |
| leased / dispatching | “已领取”“派发中” | 没有取消按钮（正确：服务端只允许取消 queued，`nano/index.ts:216`） | 用户分不清“已领取”和“派发中”，两者对用户没有区别 | 对用户合并为“生成中”，两者都不提供取消 |
| running | “执行中” | — | 实际不会出现（M7） | 保留映射作为兜底即可 |
| succeeded | 徽标“已完成”，显示图片 | — | 成功时没有任何读屏播报（见 4.5）；历史列表不会自动刷新，仍显示旧状态（见 4.3） | 见下文 |
| failed | “任务失败；原扣费由服务端退款流程处理。”（`role="alert"`） | — | “由服务端退款流程处理”含义模糊：失败时退款已经在同一事务中完成（`core.ts:297-304`） | 改为“任务失败，{cost} 积分已退回” |
| canceled | “任务已取消。” | — | 同 queued 取消 | 同上 |
| unknown | 结果区：“远端结果未知。请手动刷新；系统不会自动重发此任务。”；表单区：“此任务需要人工确认……”；按钮“再次确认” | “刷新任务”“再次确认” | ① “再次确认”与“刷新任务”调用的是同一个 `refreshTask`（`:715-730`），名称暗示用户能做确认，其实不能；② 文案让用户“手动刷新”，但没有对账出口（C1），刷新永远不会变化，除非出现迟到结果；③ `poll` 把 unknown 视为已结束（`react.ts:88-93`），即使后来自动转为 succeeded，界面也不会更新；④ 没有告诉用户积分现在的状态 | ① 删除“再次确认”；② 文案改为“结果暂时无法确认。本次已扣 {cost} 积分；我们会核对，确认未生成会退回。”（具体承诺取决于 D1）；③ unknown 状态下低频轮询（例如 30–60 秒一次），或在页面重新可见时刷新一次；④ 设计稿一上线后显示“处理中，预计 …” |

### 4.2 积分扣减与余额反馈

- **没有余额展示**：Studio 只在限制说明里写“每次 {cost} 积分”（`composer.limits`），提交前看不到当前余额。余额不足时，提交后才收到 402，提示“可用积分不足，无法创建本次任务。”。建议提交前显示余额，余额不足时禁用按钮并给出购买入口。注意组织工作区要显示组织余额（`identity.ts:105-111`）。
- **扣费后余额不刷新**：admit、失败退款、取消退款之后，页面里的余额类查询（如侧栏 `SidebarUserCard`）都不会失效。这和 TODO #2 的 query key 统一有交集，建议一起处理，但财务计算合同不变。
- “幂等返回已有任务，未重复扣费。”（`composer.idempotentReplay`）是好的反馈，予以保留。

### 4.3 空状态、错误、超时与重试

- **空状态**：结果区“选择或创建一个任务后显示结果。”，历史区“暂无任务。”，合格。
- **错误信息**：错误框同时显示翻译文案和 `{code} · {status}`（`NanoStudio.tsx:611-620`）。保留 code 便于客服，但 `status` 为 0（网络错误）时显示“· 0”，建议隐藏。`INVALID_STATE` 的文案写死成“该任务当前状态无法取消”，而这个 code 只来自取消，目前没问题，但对账功能上线后会产生歧义，建议按动作区分。
- **超时**：前端 `poll` 每秒一次、**没有上限**（`react.ts:212-224`）。lease 最长 180 秒，一次任务可能轮询约 180 次。建议改为指数退避（1 秒到最多 5 秒），超过 lease 时长后停止并提示“仍在处理，稍后回来查看”。
- **重试**：`fetchJson` 最多尝试 3 次（`react.ts:126-151`）。admit 重试时沿用同一个 requestKey，是安全的。轮询中某次 GET 三次都失败后，`watch` 会显示错误并停止轮询（`NanoStudio.tsx:281-287`），不会自动恢复。建议错误文案加上“继续等待”按钮（重新 `watch`），而不是让用户自己找“刷新”。
- **历史同步**：`watch` 结束时不会更新 `historyRefreshToken`，只有 admit 和 cancel 会（`:510`、`:555`）。所以结果区显示“已完成”时，历史列表仍是“排队中”。建议轮询结束时刷新历史，或把最新状态直接合并进列表。
- **“重放同一请求”按钮**：只要输入没变就一直显示（`canReplay`，`:564-572`），容易被理解成“再生成一次”。它的真实语义是丢失响应后的幂等重放。建议只在 admit 报 `NETWORK_ERROR` 或 `ABORTED` 时显示，文案改为“重新提交上次请求（不会重复扣费）”。

### 4.4 换号、退出、晚响应

| 场景 | 现状 | 风险 | 建议 |
| --- | --- | --- | --- |
| 换号（A 退出、B 登录，同一标签页） | 重置 task、error 和 notice，但保留 prompt、upload 和 case（C7 补充 2）；然后用全局键为 B 恢复 A 的任务，得到 404 和错误提示 | 共享设备上泄露 A 的输入；B 看到莫名其妙的错误 | 全部表单状态一起重置；本地键改为 `nexty:nano:last-task-id:v2:<subjectKey>`；遇到 v1 旧键直接删除（不迁移：无法判断归属）；收到 404 时静默删除该键，不显示错误 |
| 退出 | `isSignedIn=false` 时直接返回（`:320`），不清除本地键 | 下一个登录的人会读到 | 退出时删除当前 subject 的键 |
| 切换工作区（同一用户） | 不重置（C7 补充 1） | 显示个人任务，但服务端按组织校验，返回 404 | 重置依据改为 `subjectKey = activeOrganizationId ?? userId`，从 `session.session.activeOrganizationId` 读取 |
| 晚响应（admit 发出后换号） | 结果回来后仍写键并开始 watch（`:505-517`） | 写入错误的 subject | 发起时记下 `subjectKeyAtSubmit`，`await` 返回后比较：不一致就丢弃结果，不写键、不 watch，只提示“账号已切换，上一请求结果未显示” |
| 晚响应（get 或 poll） | 已用 AbortController 和 ref 比对防护（`:226-258`、`:263-296`） | — | 保留 |

### 4.5 可访问性（逻辑层）

- **状态播报**：
  - 轮询提示 `role="status"` 只在轮询期间渲染（`:742-746`），轮询结束时元素消失，读屏通常不会播报“已完成”；
  - 结果区的状态徽标不是 live region（`NanoResultPanel.tsx:33-35`）；
  - unknown 和 canceled 用了 `role="status"`，failed 用了 `role="alert"`（`:44-58`），这部分合理。

  建议用一个常驻的 `aria-live="polite"` 区域，在状态迁移时播报“任务 {短 id} 已完成，生成 N 张图片”或“任务失败，积分已退回”。
- **错误焦点**：错误 `Alert` 带有 `role="alert"`（`:612`），会播报，但焦点不会移动。对于输入校验错误（`INVALID_INPUT`），建议把焦点移到对应字段，并加上 `aria-invalid` 和 `aria-describedby`，因为目前错误文案是统一的“请检查提示词、图片类型和图片大小”，读屏用户定位不到具体字段。
- **历史列表**：每行有两个按钮都执行 `onSelect`，第一个按钮的可读名是整个 UUID（`NanoTaskHistory.tsx:149-156`），读屏会逐字读出 36 个字符。建议只保留一个“查看”按钮，`aria-label` 写成“查看 {创建时间} 的任务，状态 {状态}”。时间直接显示 ISO 字符串（`:161`），建议本地化。
- **键盘**：所有可操作元素都是原生 `button`、`input` 或 `textarea`，Tab 顺序天然成立（逻辑层判断，没有验证实际渲染）。“重放同一请求”和“再次确认”这两个按钮的语义问题见上文。
- **生成中的按钮**：提交按钮在 `submitting || polling` 时禁用并显示“处理中……”（`:681-695`）。建议加 `aria-busy`，并把整个表单放进 `fieldset disabled`，避免轮询期间修改输入导致 `canReplay` 状态跳变。

### 4.6 管理员处理 `unknown` 的交互流程草案

依赖设计稿一。入口：`/dashboard/admin/nano`。

1. **列表页（只读，可以先于资金动作上线）**
   - 默认筛选“unknown，且已超过 10 分钟”（阈值待定），按 `created_at` 升序，游标分页。
   - 列：短 id、主体（用户邮箱或组织名）、扣费、`spendTxId` 链接到积分流水、`provider_request_key`、unknown 持续时长、是否已 staged（已 staged 的只读，标注“等待自动收尾”）。
   - **不显示**提示词和图片。如确需查看，单独加“查看输入”按钮，并记录审计（D3、D4）。
   - 顶部统计：unknown 总数、本周新增数、最长持续时间。没有服务端数字时显示“—”，**不编造**。
2. **处理对话框**（选中一条后打开）
   - 显示任务摘要和对用户的影响（“退款 {cost} 积分到 {主体}”或“不退款，任务标为失败”）。
   - 单选“退款”或“不退款”，“原因”为必填文本框，然后确认。
   - 提交期间按钮禁用；带上 `expectedUpdatedAt`。
   - 结果反馈三种：
     - 成功：“已处理，退款流水 {txId}”；
     - 并发失败（`changed:false`，或状态已变）：“该任务已被其他人或自动流程处理为 {状态}”，并刷新这一行；
     - 已 staged：“该任务已有结果，正在自动收尾，无需处理”。
3. **批量处理**：首版不做。批量退款的风险高于收益，等 S2 自动策略上线后再评估。
4. **权限**：`isAdmin` 可以查看；“退款”动作是否只限 `isSuperAdmin`，由业务决定（D1 附带）。
5. **可访问性**：对话框聚焦到第一个可操作控件；处理结果用 `aria-live` 播报；关闭对话框后焦点回到触发它的行。

---

## 5. 任务 4：架构与项目结构评估

### 5.1 现在做

| # | 建议 | 代码事实 | 解决的具体问题 |
| --- | --- | --- | --- |
| N1 | `turbo.json` 的 `typecheck.dependsOn` 加上 `^build` | 干净 checkout 上执行 `turbo run typecheck` 报 TS2307（M3，本轮实测） | 新接手的人或 CI 按文档入口执行时会直接失败 |
| N2 | 修正或删除 `packages/persistence-pg/legacy-reference`，或者把 README 改为“截至 0001 的冻结副本”，并补一条哈希守护测试 | README 声称逐字节一致，但实际缺少 0002，`_journal` 哈希也不同（C3/M5）；该目录会被发布（`package.json:43`） | 发布物中的“参考”与实际不符，会误导 D1b 的升级规划 |
| N3 | 新增 `_n2` 与 `_niu` 链的 DDL 等价守护测试（以 `evidence/ddl-compare.py` 为原型，白名单是应用自有的 CMS 和反馈表） | 目前没有任何守护（C3） | 今后任一条链单独增加 DDL，就会让未来的接管失败，而且没有人会发现 |
| N4 | `docs/agent-review-loop.md` 三处口径修正：① domain 用例缺少变量时是 fail 不是 skip（M8）；② typecheck 需要先 build（M3）；③ 代理环境下 engineering 测试要用离线模式并预热缓存（M4） | 本轮实测 | 避免下一个执行者把环境问题误判为回归，或把 fail 当作 skip |
| N5 | `docs/platform-architecture.md` §6 补一句“参考应用当前使用 `_n2` 链，尚未接入 `checkProfileCompatibility`” | C3 | 消除文档和应用之间的不一致 |

### 5.2 触发后再做

| # | 建议 | 触发条件 | 代码事实 | 解决的问题 |
| --- | --- | --- | --- | --- |
| T1 | `persistence-pg` 的内部依赖改为 optional peer：`auth`、`commerce`、`feature-nano` 设为 `peerDependencies` 且 `peerDependenciesMeta.optional`，`contracts` 继续作为 dependency；各子路径只在被导入时才需要对应 peer | **第二消费者明确只用 Auth，且精确版本牵连已造成实际阻碍**（例如只想升级 auth，却必须同步发布 commerce 和 nano） | `package.json:52-57`。`persistence-pg` 的根入口只导出 migrations，Auth/Commerce/Nano 都在各自子路径（`docs/platform-architecture.md` §3），具备这样改的结构条件 | 7 个包的闭包缩小到 4 个（auth、next、db、persistence-pg，加上 contracts） |
| T1′ | 按领域把 `persistence-pg` 拆成 `persistence-pg-auth`、`-commerce`、`-nano` | **只有在 T1 的 optional peer 方案被证明不可行时**（例如 `dependency-boundaries.mjs` 禁止 optional peer 的子路径导入） | — | 属于**大改**：包数量从 10 增加到 12；`release/packages.json`、release gate、边界脚本、文档和 profile 都要改；迁移模块要跨包协调依赖顺序。回退方式是保留原包作为聚合 re-export。与当前 TODO 不冲突，但与 P6（真实 registry）相关，应在 P6 之前定案。**不推荐首选** |
| T2 | `_n2 → _niu` 接管：在 `_niu` journal 中写入等价模块记录，标记为“adopted”；应用改为调用包内 runner，同时继续执行应用自有的 CMS 和反馈 DDL | **出现第一个需要同时改两条链的 schema 变更**（例如设计稿一的 A2），或者准备 D1b 存量演练时 | C3 | 结束双链维护 |
| T3 | 统一生命周期：把 `composition/*` 改为显式的 `createAppContainer({ env })`，返回 `{ db, auth, commerce, nano, close() }`；Next 侧只保留一个惰性入口；失败时不缓存（失败后清空 Promise） | **出现第二消费者需要复用 composition**，或需要在测试或 Worker 中构造多实例 | C8：四种写法；`lib/db/index.ts:19-21` 在 import 时捕获 | 当前的惰性 Promise 会永久缓存失败（C8），而且 import 时捕获 db 让 `closeDatabase` 语义失真。**其中“失败不缓存”这一小步建议提前到“现在做”**（`commerce.ts:165`、`nano.ts:69` 各改一行，在 reject 时把缓存重置为 undefined） |
| T4 | 独立 Nano Worker | C9 的三个触发条件 | `runtime.ts:27-28` | — |
| T5 | 结果图片移出 PG 行，改存对象存储（`NanoObjectImage` 类型已经预留，`dto.ts:13-16`、`:42-48`） | PG 容量或备份时长出现压力，或者 D3 决定了保留期 | C5 | 行体积；保留策略可以执行 |

### 5.3 保持不动

| # | 对象 | 理由（代码事实） |
| --- | --- | --- |
| K1 | `@niu/*` 与 `@sunpcm/niu-*` 两套前缀并存 | 命名其实是一致的：`@niu/*` 全部是 `private: true`（`@niu/mail`、eslint、postcss、tailwind、tsconfig 配置包，本轮读取了各包的 `package.json`），`@sunpcm/niu-*` 是发布物。真正的约束由 release allowlist 加上 `test/engineering.test.mjs:282`、`:306-308` 强制执行（不在 allowlist 中的必须是 private）。改名会动 `apps/web` 的依赖、tsconfig 和 eslint 引用，没有收益。**只建议**在 `docs/platform-architecture.md` §2 加一句命名规则 |
| K2 | `apps/web` 中 `composition/`、`lib/`、`config/` 的分层 | `config/` 是纯配置读取（`config/nano.ts`、`site.ts`）；`composition/` 是装配；`lib/` 是应用用例和适配（`lib/nano/admit.ts`、`dispatch.ts`）。职责基本清晰。唯一的例外是 `lib/auth/index.ts:130-157` 在 `lib/` 中装配 Auth，可以随 T3 一并收拢，单独移动没有收益 |
| K3 | `packages/db/src` 中的旧 schema、23 个迁移和 seed | 已被 `packages/db/tsconfig.json` 的 `include`/`exclude` 排除在构建之外；不在 `files` 中，不会发布（`package.json` 的 `files: ["dist"]`）；全仓没有引用；`index.ts:1-9` 注释已说明“historical reference only”。删除需要先确认 D1b 存量演练是否需要它们（`TODO.md` 外部待验 D1b），**在 D1b 定案前不动**。代价是 `eslint src` 会扫描它们，这只影响 lint 时长，不影响正确性 |
| K4 | `test/` 的组织（engineering / domain / packages / fixtures 四类） | 与入口一一对应（`package.json` 的 `test:*` 脚本），按 glob 自动收录（`test:domain` 用 `test/domain/*.test.ts`）。没有观察到放错位置的测试。建议保持不变 |
| K5 | 不拆微服务，保持模块化单体 | `docs/platform-architecture.md` §1、§9 有明确取舍；本轮没有发现与之冲突的负载或发布证据 |

### 5.4 文档重叠与最少阅读集

| 文档 | 实际承担的内容 | 与其他文档重叠的部分 |
| --- | --- | --- |
| `AGENTS.md`（48 行） | 规则：边界、实施与评审分离、运行时 | 运行时版本在 `HANDOFF.md` 中重复 |
| `HANDOFF.md`（103 行） | 基线、状态口径、恢复顺序 | 恢复顺序在 `TODO.md` 和计划 §0 中**各有一份**，三处内容略有出入（`TODO.md` 含四模型池，`HANDOFF.md` 没有） |
| `TODO.md`（35 行） | 待办、外部待验 | 包含本机绝对路径（`TODO.md:5`），与 `AGENTS.md`“不要把旧会话的本机绝对路径写入项目规则”不一致（`TODO.md` 不算规则文件，但同样会误导云端执行者） |
| `docs/platform-architecture.md` | 长期架构合同 | §6 启动兼容检查的说法与应用不符（C3） |
| `docs/agent-review-loop.md` | 测试入口、PG 变量、历史口径 | 历史段落占比大；口径问题见 N4 |
| `docs/migrations-canonical.md` | `_n2` runner | 只讲 `_n2`，没有提到 `_niu`，读者会以为只有一条链 |
| 计划 §0 | 实施状态 | 与 `HANDOFF.md` 状态口径重复 |

**新接手者的最少阅读集**（按顺序）：

1. `AGENTS.md`：规则，必读；
2. `HANDOFF.md`：基线和状态；
3. `docs/platform-architecture.md`：架构合同；
4. `docs/agent-review-loop.md` 的“可运行入口”和“隔离身份与 guard”两节：执行检查时才需要。

`TODO.md` 只在恢复产品工作时阅读；计划 §0 和 `docs/migrations-canonical.md` 按需阅读。

**建议（现在做，纯文档）**：恢复顺序只保留在 `TODO.md` 一处，`HANDOFF.md` 和计划 §0 改为链接到它；`docs/migrations-canonical.md` 开头加一句“另有包内 `_niu` profile 链，见 platform-architecture §6”。

---

## 6. 需要用户决策的事项

| # | 决策 | 选项 | 代价 | 本文推荐 |
| --- | --- | --- | --- | --- |
| D1 | `unknown` 的处置策略 | S1 人工 / S2 超时自动退款 / S4 混合 / S5 新增终态 | 见 §3.1.3 | 不替用户选。工程上建议**先上线观测和只读列表**，这一步与策略无关 |
| D2 | 人工处置后，迟到结果是否还能覆盖 | a 不能（CAS 加清除 lease 保证）/ b 能（退款后又交付，需要撤销退款） | b 需要“撤销退款”的财务流程，复杂度高 | a |
| D3 | 输入图片和结果图片的保留期 | 永久（现状）/ 终态 N 天后清空 `input_ref.imageData` / 结果也清理 | 清理后历史无法回看原图；不清理则是隐私和容量风险 | 待定（属于业务和合规问题） |
| D4 | 组织工作区内成员能否互相查看任务（M6） | 保持共享 / 只看自己发起的（需要在任务中记录 `actor_user_id`，**schema 变更**）/ 只有管理员能看全部 | 共享有隐私风险；改造需要动 schema | 待定 |
| D5 | 第二消费者是否需要“有组织、无计费”，以及席位语义 | 不需要（形态一即可）/ 固定上限 / 无限 | 需要时实施 §3.2.2 | 先按形态一交付样板，等真实需求出现再做形态二 |
| D6 | unknown 处置的审计落点 | A1 只用 ledger note（无 schema 变更，“不退款”无法留痕）/ A2 新表（增量 schema，两条链都要追加） | 见 §3.1.5 | 如果 D1 包含“不退款”选项，则需要 A2 |
| D7（**已决定：允许**，探针已执行，见 §7.1 第 19–20 条） | 是否允许在本容器自建临时 PG16 集群运行 `evidence/probe-c1-c2-unknown.mjs` | a 允许：容器里有 `/usr/bin/psql` 和 `/usr/lib/postgresql/16`，可以在 scratchpad 里 `initdb` 一个只属于本会话的空库 / b 不允许，交给主控用标准隔离库代跑 / c 两者都做 | a 不符合 `docs/agent-review-loop.md` 规定的库名、角色和变量（探针用的是 `fable_probe_*` guard），所以只能算补充证据 | b（与仓库规则一致）；a 可以作为快速佐证 |

---

## 7. 执行记录

### 7.1 实际运行的命令

运行时：除第 1–2 条之外，均为 Node v24.15.0（scratchpad 内的官方二进制，SHA256 已校验）和 pnpm 10.26.0。

| # | 命令 | 退出码 | 摘要 |
| --- | --- | --- | --- |
| 1 | `git fetch origin codex/nexty-platform-overnight-20261105`；`git checkout -B … origin/…`；`git rev-parse HEAD`；`git status --short --branch` | 0 | HEAD 为 `ae5ae2c…`，工作树干净 |
| 2 | `node --version`；`pnpm --version`（宿主自带） | 0 | v22.23.4 / 10.26.0 |
| 3 | 下载 `node-v24.15.0-linux-x64.tar.xz` 和 `SHASUMS256.txt`，执行 `sha256sum -c` | 0 | 校验通过 |
| 4 | `HUSKY=0 pnpm install --frozen-lockfile` | 0 | 11.6 秒完成；工作树仍然干净 |
| 5 | `pnpm exec turbo run typecheck`（未先 build） | **2** | `@sunpcm/niu-feature-nano` 报 TS2307（M3） |
| 6 | `pnpm build:packages` | 0 | 9/9 |
| 7 | `pnpm exec turbo run typecheck` | 0 | 11/11 |
| 8 | `pnpm check:boundaries` | 0 | `violations: []`、`missingDist: []` |
| 9 | `node --test --test-concurrency=1 test/packages/*.test.mjs` | 0 | 179 项：171 通过 / 0 失败 / **8 skip**（缺少 `AUTH_PG_TEST_URL`、`AUTH_CREDITS_PG_TEST_URL`、`COMMERCE_PG_DATABASE_URL`、`PG_PROFILES_*`），**skip 项记为未验证** |
| 10 | `pnpm test:engineering`（默认在线模式） | 手动停止 | 第 3 项外部消费者 `pnpm install --ignore-workspace` 超过 12 分钟没有进展。原因是 `commandEnv` 不透传代理设置（M4）；停止后工作树干净 |
| 11 | `ENGINEERING_PNPM_INSTALL_MODE=offline ENGINEERING_PNPM_STORE_DIR=<本机 store> pnpm test:engineering` | 1 | 3/4 通过；外部消费者报 `ERR_PNPM_NO_OFFLINE_META`；源码变异项通过，并且四个文件的哈希都已恢复 |
| 12 | 在 scratchpad 中新建 `warm/`（只含 `prettier@3.8.0` 和 `prettier-plugin-tailwindcss@0.7.2`），执行 `pnpm install --ignore-workspace` 预热 metadata | 0 | 不涉及仓库文件 |
| 13 | 同第 11 条重跑 | 0 | **4/4 通过**（离线模式加预热缓存，**偏离默认在线模式，已记录**） |
| 14 | `pnpm test:routing` | 0 | 4/4 |
| 15 | `pnpm test:domain`（未注入 PG） | 1 | 234 项：104 通过 / **119 失败** / 11 skip。119 项失败的原因全部是 `DATABASE_URL is not set` 或 `MIGRATION_*_DATABASE_URL`（fail-closed），**记为未验证，不是回归** |
| 16 | `python3 -I evidence/ddl-compare.py <repo>` | 0 | 结果见 `evidence/ddl-compare-output.txt` |
| 17 | `sha256sum` 两组迁移文件 | 0 | 见 C3 |
| 18 | `node --check evidence/probe-c1-c2-unknown.mjs` | 0 | 只做了语法检查 |
| 19 | 经用户授权，在 scratchpad 中 `initdb` 一个临时 PG 16.15 集群（只监听 127.0.0.1:55432，trust 认证），新建角色 `fable_probe_role` 和空库 `fable_probe_c1c2` | 0 | 集群只属于本会话，用完已 `pg_ctl stop`；没有连接其他任何库 |
| 20 | `FABLE_PROBE_PG_URL=… FABLE_PROBE_EXPECTED_DB=fable_probe_c1c2 node evidence/probe-c1-c2-unknown.mjs` | 0 | C1a、C1b、C1c、C2 四个场景全部通过，输出见 `evidence/probe-c1-c2-output.md`；同时观察到 M10 |

各次运行后用 `git status --short` 复核，工作树都保持干净；本交付目录是唯一新增的内容。

### 7.2 未运行的项及原因

| 项 | 原因 |
| --- | --- |
| 所有仓库 PG 用例（`auth-pg`、`commerce-pg`、`pg-profiles-pg`、domain 中的 PG 用例、migration C01/fault） | 这些用例要求 `docs/agent-review-loop.md` 规定的库名、角色和变量；本轮的自建集群只用来跑探针，没有伪造这些身份，所以仍记为未验证，交主控在标准隔离库代跑 |
| Web lint / build / `build:turbopack` | 与本轮结论无关；默认构建内存问题属于 TODO #3，不在本轮范围内 |
| 浏览器 / 截图 / 登录态 | 不具备这项能力，任务 3 只做了逻辑层评审 |
| 真实 AI、支付、SSO、registry | 被禁止 |

### 7.3 外部依赖状态

| 依赖 | 状态 |
| --- | --- |
| npm registry（经宿主代理） | 可达；主安装使用冻结锁文件 |
| nodejs.org | 可达，只用于下载 Node 24.15.0 |
| 真实 Google GenAI / Stripe / Creem / PayPal / SSO / 私有 registry | 没有调用 |
| PostgreSQL | 宿主没有注入；只连接过本会话自建的临时库 `fable_probe_c1c2`，用完已停止 |
| 真实 `.env` 或凭据 | 没有读取 |

### 7.4 提交

- 分支：`claude/fable-architecture-review-20261110`，从 `ae5ae2cf9f10fe2bb5fc1969215ff8aee9ccbb3e` 创建。
- 提交范围：只有 `review-delivery/FABLE-ARCH-20261110/`。
- 不开 PR，不合并，不 push 其他分支。
- 停在 Review，等待 Codex 独立核验。
