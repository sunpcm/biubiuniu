# 阶段 1 设计：参考应用改用包内迁移链（P1-2 完成，P1-3 下一张）

方案 A 已确认。P1-1 已完成独立审核并发布到 `260f664`；P1-2 已在当前工作树实现，并通过正式合成验收；
下一张卡为 P1-3。目标是让 `apps/web` 成为 `_niu` 链的第一个真实消费者：`apps/web` 使用包内 runner
（`packages/persistence-pg` 的 `runMigrations` / `checkProfileCompatibility`），CMS/反馈表变成产品自有
迁移模块，启动时接入只读兼容检查，并废弃应用内重复 runner 的活跃接线。阶段 0 的 auth gate
（release gate 加 `auth` profile、`_niu`↔`_n2` DDL 等价守护、`legacy-reference` 口径修正）已完成，
本阶段不重做。

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

### 接管能力（P1-2 已实现）

包内 `/migrations` 现行导出：

- `captureMigrationSchemaContract(options: MigrationRunnerOptions)`：从真实跑过产品迁移的参考库生成紧凑合同。
- `takeoverMigrations(options: MigrationRunnerOptions & { schemaContract; legacyJournal })`：在旧 `_n2`
  库上核对并仅回填产品 `_niu` 账本。

公开 `schemaContract` 固定为 `formatVersion`、`postgresMajor`、`profile`、`modules`、`schemaHash` 五个字段。
完整结构快照在包内稳定排序后生成 SHA-256，保留表、列、enum、sequence、index、constraint、trigger、policy
等分项 hash 作为错误诊断；`schemaHash` 覆盖列类型、NULL、默认值、identity/generated、列序与 collation，
enum 有序 labels，索引，PK/UNIQUE/FK 等约束定义及有效性，identity sequence 配置与所属，非内部 FK 触发器
和策略，并纳入表 `relpersistence` / RLS。三张已知迁移元数据表及其表拥有的索引被排除。

接管与普通包内 runner 共用默认 advisory lock、同一事务、账本 DDL 与写入。锁后先核对完整旧 `_n2`
journal，再在固定 `pg_catalog` search path 下采集实际结构并验证合同；只有前两项通过才检查 `_niu`
元数据。完整账本必须逐模块、版本、合同版本、双重 checksum 和 profile 完全一致，随后只读返回；仅在
两张账本都不存在时创建并回填。半份账本、错误旧 ref、结构漂移、空旧 ref 或自定义 journal/profile 表名
均 fail closed。任何路径都不执行 `module.statements`，`verifySchema:false` 也不能绕过结构合同。失败整轮
回滚，旧 `_n2_migration_journal` 行、旧业务数据和历史迁移字节保留。

本阶段合同与验收只覆盖固定 PG16 合成库。它证明包链参考结构与完整旧链一致，不代表其他 PostgreSQL
版本、真实数据、生产迁移或发布验收。

### 接管期间的互斥边界

包内 advisory lock 只协调包内普通迁移与 takeover。旧应用 runner/旧 `db:migrate` 使用不同锁域，因此
在执行接管前必须先停用旧 DDL 执行入口，不能假定两套 runner 会互斥。停用的是活跃调用路径；历史迁移
SQL、module、meta 与 `legacy-reference` 仍按字节冻结保留，P1-3 再完成应用接线替换。

### 产品物理核对与启动检查

P1-2 的 takeover 已用完整结构合同覆盖产品 5 表（posts/tags/post_tags/feedback/feedback_replies）、6 枚举
以及其余 public 结构，因此接管不再依赖旧 sentinel 子集。P1-3 仍需把产品表加入启动期
`checkProfileCompatibility` 的 sentinel 接线；不能把当前只识别 `auth`/`payments`/`credits`/`nano` 的
read-only check 当作已经覆盖 `cms_feedback`。

### 空库、旧库与启动检查

- **全新空库**：包内 runner 用 `nano_payments` profile + `cms_feedback` 模块一次建齐全部表。
- **旧 `_n2` 库**：走上述接管路径，只回填 `_niu` 账本，零业务 DDL。
- **启动兼容检查**：只读，核对 journal、contract version 与 sentinel（含新增的产品 sentinel），不建 journal、
  不跑 DDL；不兼容则拒绝启动。

## 三、建议拆 3 张卡

| 卡                        | 写集                                                                                                                                                                                                                                                                                                                                                                             | 实际可运行验收入口                                                                                                                                                                                                                                                                                                                                        | 停止条件                                                                     | 状态                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1 产品 CMS/反馈模块       | 新增 `apps/web/src/lib/db/product-migrations/cms-feedback.ts`、同目录 `index.ts`，并在 `scripts/test-pg-local.mjs` 增加 `n3_product`；测试入口为 `test/domain/product-migrations.test.ts`。产品 SQL 静态复用旧链的 5 表、6 枚举、6 个 FK 和 14 个非约束索引；`PRODUCT_MIGRATION_PLAN` 装配 profile、modules 与 roots。历史迁移 SQL/module/meta/`legacy-reference` 保持字节冻结。 | PG16 下比较 5 表、6 枚举、13 约束、21 索引及逐列物理定义；该卡验收时 domain 267、packages 211、零 skip，临时库已清理。                                                                                                                                                                                                                                    | 历史迁移字节被改，或对非自建合成库执行，或空库产物与 `_n2` 同名对象不一致    | 已完成；独立审核后已随 `260f664` 发布                  |
| 2 接管核对 + 账本回填     | 修改 `packages/persistence-pg/src/migrations/runner.ts`，新增 `schema-contract.ts` 并更新 `index.ts` 导出；新增 `test/domain/product-migration-takeover.test.ts`，在 `scripts/test-pg-local.mjs` 增加 takeover 目标/参考两库；同步 `TODO.md`、本设计和本地 PG 测试说明。普通 runner 语义保持，takeover 复用其默认锁、事务和账本 DDL。                                            | PG16 正式合成验收：domain 273、packages 211、零 skip；typecheck 20、lint 106 个既有 warning/0 error、routing 4、离线 engineering 4。包链参考库生成的结构指纹与完整旧链匹配；view、collation、relpersistence、错误 checksum、半份账本均 fail closed；并发接管一实写一跳过；合成事件触发器令第二个元数据 DDL 报错时两代账本原子回滚，旧账本保留，容器清理。 | 执行业务 DDL、自动修差异、删除旧账本、半份账本回填、放宽指纹或对非自建库执行 | 实现与合成验收已完成，独立 Review 和提交发布见本卡回执 |
| 3 应用接线 + 启动只读检查 | `apps/web` 的 `db:migrate` 与启动路径改走包内 runner（含产品模块）；废弃重复 runner 活跃 import；启动接入 `checkProfileCompatibility`（含产品 sentinel）。建议测试入口 `test/packages/pg-startup-compat.test.mjs`（需合成 PG）                                                                                                                                                   | 空库与旧 `_n2` 库上 `pnpm --filter @niu/web db:migrate` 都走包内入口；构造不兼容库时检查返回 incompatible 且应用拒绝启动。                                                                                                                                                                                                                                | 改历史迁移字节、自动迁移生产/非自建库、启动检查建 journal                    | 下一张；未开始                                         |

## 四、方案 A 已确认、回退前提与不变量

方案 A 已由用户确认（2026-11-18）。P1-1 已完成独立审核并发布到 `260f664`；P1-2 实现与合成验收已完成，
独立 Review 和提交发布见本卡回执；P1-3 是下一张卡。
两份旧文档的口径已经修正：[`2026-11-11-platform-roadmap.md`](2026-11-11-platform-roadmap.md) 的阶段 1
退出条件改为“仅一个活跃权威入口，历史保留”；[`2026-11-11-nano-followups.md`](2026-11-11-nano-followups.md)
已把经批准的 `_n2` 到 `_niu` 接管移入阶段 1 并链接本设计，不再表述为等待触发。

回退前提仅限本阶段未改业务 schema 且旧应用仍接受当前数据库合同；不承诺后续任意版本重部署必可回退。

不变量：`PRODUCT_ID` 保持 `BiuBiuNiu`；既有迁移 SQL/module/meta/`legacy-reference` 字节不改；资金与
状态同事务；不读真实 `.env`/凭据；不连接非本卡自建合成 PG；不调用真实 AI/支付/SSO/registry。
PG16 指纹是本阶段测试合同，不扩展到其他 PostgreSQL 版本或生产验收。接管期间必须停用旧应用 DDL
执行入口；包内 advisory lock 不能与旧 runner 的锁域互斥。
