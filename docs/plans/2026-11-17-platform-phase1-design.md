# 阶段 1 设计：参考应用改用包内迁移链（P1-D，方案 A 已确认，实施暂停）

方案 A 已确认，实施暂停；本页只记录已确认设计。目标是让 `apps/web` 成为 `_niu` 链的第一个真实消费者：`apps/web` 使用包内
runner（`packages/persistence-pg` 的 `runMigrations` / `checkProfileCompatibility`），CMS/反馈表变成
产品自有迁移模块，启动时接入只读兼容检查，并废弃应用内重复 runner 的活跃接线。阶段 0 的 auth gate
（release gate 加 `auth` profile、`_niu`↔`_n2` DDL 等价守护、`legacy-reference` 口径修正）已完成，本卡
不重做。

## 一、设计冲突与推荐 A

路线图阶段 1 的退出条件写“仓库里只剩一份平台 DDL”，但这条不能通过删除或改写既有 SQL、module、
`legacy-reference` 达成，否则会破坏迁移字节不变量与历史回退证据。

推荐 A：**只保留一个活跃权威迁移入口**，即包内 `_niu` runner；既有
`apps/web/src/lib/db/migrations/*.sql`、`meta/_journal.json`、`packages/persistence-pg/legacy-reference/**`
全部按字节冻结保留，仅作为历史/兼容资产。应用内重复 runner（`apps/web/src/lib/db/migration-runner.ts`、
`migration-source.ts`）废弃活跃接线——不再被 `db:migrate`/启动路径 import——但文件与历史迁移字节不动。

这样“权威入口唯一”由“活跃接线唯一”达成，而不是“物理删除历史 DDL”。

## 二、接管、兼容与新增能力

### 精确迁移配置

既有 `PROFILES.nano_payments.modules = ["auth", "payments", "credits", "nano"]`。产品模块
`cms_feedback`（依赖 `auth`）追加为根，`roots` 为该四模块并上 `"cms_feedback"`，`profile` 标签用显式产品
名（建议 `"nano_payments_cms"`），`url` 必须是本卡自建合成 PG 连接串。现有真实迁移 CLI 只有
`pnpm --filter @niu/web db:migrate`（当前指向 `_n2` runner，卡 3 后改指向包内 runner）。

### 接管是新增能力

当前包内没有 `takeover` 导出。接管需新增：与常规 runner 相同锁域（`pg_advisory_xact_lock(hashtext(${lockKey}))`），
先只读逐物理结构/合同核对（逐表列、类型、枚举、索引、约束、外键比对平台四模块与产品模块的期望对象），
任一不一致即拒绝、不自动修；核对通过后，在同一事务内新建并回填 `_niu_migration_journal` 与
`_niu_migration_profile` 两张元数据表。失败整轮回滚、零持久化，重复与并发幂等。全程不跑任何业务 DDL；
新增的仅是这两张 `_niu` 元数据 DDL，须与平台/产品业务 DDL 明确区分。旧 `_n2_migration_journal` 行与
字节、旧业务数据全部保持。

### 产品物理核对是新增/接线

`checkProfileCompatibility` 的 `schemaSentinels` 只识别 `auth`/`payments`/`credits`/`nano`，忽略
`cms_feedback`；产品 5 表（posts/tags/post_tags/feedback/feedback_replies）与 6 枚举的物理核对是本阶段
须新增或接线的检查，不能把既有 check 当作已覆盖。

### 空库、旧库与启动检查

- **全新空库**：包内 runner 用 `nano_payments` profile + `cms_feedback` 模块一次建齐全部表。
- **旧 `_n2` 库**：走上述接管路径，只回填 `_niu` 账本，零业务 DDL。
- **启动兼容检查**：只读，核对 journal、contract version 与 sentinel（含新增的产品 sentinel），不建 journal、
  不跑 DDL；不兼容则拒绝启动。

## 三、建议拆 3 张卡

| 卡                        | 写集                                                                                                                                                                                                                                                                                                                                                                                              | 实际可运行验收入口                                                                                                                                                                                                                                                                                                          | 停止条件                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1 产品 CMS/反馈模块       | 新增 `apps/web/src/lib/db/product-migrations/cms-feedback.ts`（`MigrationModule`、依赖 `auth`）与模块清单拼装点；不改包内模块、不改 `apps/web/src/lib/db/migrations/**`。建议测试入口 `test/domain/product-migrations.test.ts`（现有 tsx/domain runner 可直接加载 app TS，需合成 PG）；`test/packages/pg-product-module.test.mjs`（不连库，校验 manifest/checksum）仅作补充，不能代替合成 PG 核表 | 通过待新增合成 PG 测试直接调用现有包 `runMigrations({ url, profile: "nano_payments_cms", modules: [...ALL_MODULES, cmsFeedback], roots: [...PROFILES.nano_payments.modules, "cms_feedback"], guard })`，迁移后只读核对 5 表 + 6 枚举；本卡不改实际 CLI，`db:migrate` 仍走旧 `_n2`，不能用它验收。该测试属待新增，本卡未运行 | 历史迁移字节被改，或对非自建合成库执行，或空库产物与 `_n2` 同名对象不一致 |
| 2 接管核对 + 账本回填     | 新增“结构核对 + 仅回填 `_niu` 账本”的 takeover 能力（建议落在 `packages/persistence-pg/src/migrations` 的 takeover 导出）。建议测试入口 `test/packages/pg-takeover.test.mjs`（需合成 PG）                                                                                                                                                                                                         | 用既有 `_n2` runner 建好合成旧库后跑接管：通过后 `_niu` 账本含各模块行、`_n2` 账本仍保留、无业务 DDL；故意改一处列差异时拒绝且不写 `_niu` 账本。`pg-takeover.test.mjs` 属待新增，本卡未运行                                                                                                                                 | 连接非自建合成 PG、自动修差异、删除旧账本或执行业务 DDL                   |
| 3 应用接线 + 启动只读检查 | `apps/web` 的 `db:migrate` 与启动路径改走包内 runner（含产品模块）；废弃重复 runner 活跃 import；启动接入 `checkProfileCompatibility`（含产品 sentinel）。建议测试入口 `test/packages/pg-startup-compat.test.mjs`（需合成 PG）                                                                                                                                                                    | 空库与旧 `_n2` 库上 `pnpm --filter @niu/web db:migrate` 都走包内入口；构造不兼容库时检查返回 incompatible 且应用拒绝启动。`pg-startup-compat.test.mjs` 属待新增，本卡未运行                                                                                                                                                 | 改历史迁移字节、自动迁移生产/非自建库、启动检查建 journal                 |

## 四、方案 A 已确认、回退前提与不变量

方案 A 已由用户确认（2026-11-18），当前实施暂停，恢复从 P1-1 先红测试开始。`docs/plans/2026-11-11-nano-followups.md`
末段“接管等触发再立项”与路线图阶段 1“唯一不该等触发条件”冲突：方案 A 已获批准，以本设计为阶段 1
实施依据；两个旧文件的口径调整留对应实施卡处理，本收口不扩写集。

回退前提仅限本阶段未改业务 schema 且旧应用仍接受当前数据库合同；不承诺后续任意版本重部署必可回退。

不变量：`PRODUCT_ID` 保持 `BiuBiuNiu`；既有迁移 SQL/module/meta/`legacy-reference` 字节不改；资金与
状态同事务；不读真实 `.env`/凭据；不连接非本卡自建合成 PG；不调用真实 AI/支付/SSO/registry。
