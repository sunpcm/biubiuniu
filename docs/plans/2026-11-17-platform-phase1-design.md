# 阶段 1 设计：参考应用改用包内迁移链（P1-3 完成，等待整体 Review）

方案 A 已确认。P1-1 已独立 Review 并发布到 `260f664`；P1-2 已独立 Review 并发布到 `ac42561`；P1-3
实施与合成验收通过，独立 Review 和提交发布状态以同卡回执为准。当前停在阶段 1 整体 Review，后续 PR
由用户创建。目标是让 `apps/web` 成为 `_niu` 链的第一个真实消费者：`apps/web` 使用包内 runner
（`packages/persistence-pg` 的 `runMigrations` / `checkProfileCompatibility`），CMS/反馈表变成产品自有
迁移模块，启动时接入只读兼容检查，并废弃应用内重复 runner 的活跃接线。阶段 0 的 auth gate（release gate
加 `auth` profile、`_niu`↔`_n2` DDL 等价守护、`legacy-reference` 口径修正）已完成，本阶段不重做。

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
`cms_feedback`（依赖 `auth`，拥有 5 表、6 enum）追加为根；`PRODUCT_MIGRATION_PLAN` 的 `roots` 为上述四
模块加 `"cms_feedback"`，`profile` 固定为 `"nano_payments_cms"`。CLI 使用受控入口显式注入的
`DATABASE_URL`，不自读 `.env`。P1-3 完成后，
`pnpm --filter @niu/web db:migrate` 已指向包内 plan（历史版本曾指向 `_n2` runner）。

### 接管能力（P1-2 已发布）

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
SQL、module、meta 与 `legacy-reference` 仍按字节冻结保留，P1-3 已完成应用接线替换。

### 产品物理核对与启动检查

P1-2 的 takeover 已用完整结构合同覆盖产品 5 表（posts/tags/post_tags/feedback/feedback_replies）、6 枚举
以及其余 public 结构，因此接管不再依赖旧 sentinel 子集。P1-3 已把同一组产品表/enum 作为应用提供的
optional sentinel 接入 `checkProfileCompatibility`，并启用 `requireProfileActivation: true`。检查逐行要求
`_niu_migration_journal.contract_version` 精确匹配，不能只取最大版本，同时要求
`_niu_migration_profile` 含 `nano_payments_cms`；缺省参数时包内 API 保持原默认行为和返回结构，缺 enum
sentinel 沿用 `missingTables` 的 `enum:name` 诊断。所有表 sentinel 都要求 public `relkind` 为 `r` 或 `p`，
同名 view 不能冒充产品表。

### 空库、旧库与启动检查

- **全新空库**：包内 runner 用 `nano_payments_cms` profile 一次建齐五个模块的全部物理对象。
- **旧 `_n2` 库**：走上述接管路径，只回填 `_niu` 账本，零业务 DDL。
- **启动兼容检查**：只读核对 journal、逐模块 contract version、profile activation 和 sentinel，不建
  journal、不跑 DDL；不兼容时进程 exit 1，不启动 Sentry/Nano，不进入可服务状态。

## 三、三张卡的实施与验收

| 卡                        | 写集                                                                                                                                                                                                                                                                                                                                                                                                                                                | 实际可运行验收入口                                                                                                                                                                                                                                                                                                                                                                                                  | 停止条件                                                                              | 状态                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1 产品 CMS/反馈模块       | 新增 `apps/web/src/lib/db/product-migrations/cms-feedback.ts`、同目录 `index.ts`，并在 `scripts/test-pg-local.mjs` 增加 `n3_product`；测试入口为 `test/domain/product-migrations.test.ts`。产品 SQL 静态复用旧链的 5 表、6 枚举、6 个 FK 和 14 个非约束索引；`PRODUCT_MIGRATION_PLAN` 装配 profile、modules 与 roots。历史迁移 SQL/module/meta/`legacy-reference` 保持字节冻结。                                                                    | PG16 下比较 5 表、6 枚举、13 约束、21 索引及逐列物理定义；该卡验收时 domain 267、packages 211、零 skip，临时库已清理。                                                                                                                                                                                                                                                                                              | 历史迁移字节被改，或对非自建合成库执行，或空库产物与 `_n2` 同名对象不一致             | 已完成；独立审核后已随 `260f664` 发布                  |
| 2 接管核对 + 账本回填     | 修改 `packages/persistence-pg/src/migrations/runner.ts`，新增 `schema-contract.ts` 并更新 `index.ts` 导出；新增 `test/domain/product-migration-takeover.test.ts`，在 `scripts/test-pg-local.mjs` 增加 takeover 目标/参考两库；同步 `TODO.md`、本设计和本地 PG 测试说明。普通 runner 语义保持，takeover 复用其默认锁、事务和账本 DDL。                                                                                                               | PG16 正式合成验收：domain 273、packages 211、零 skip；typecheck 20、lint 106 个既有 warning/0 error、routing 4、离线 engineering 4。包链参考库生成的结构指纹与完整旧链匹配；view、collation、relpersistence、错误 checksum、半份账本均 fail closed；并发接管一实写一跳过；合成事件触发器令第二个元数据 DDL 报错时两代账本原子回滚，旧账本保留，容器清理。                                                           | 执行业务 DDL、自动修差异、删除旧账本、半份账本回填、放宽指纹或对非自建库执行          | 已完成；独立 Review 后已随 `ac42561` 发布              |
| 3 应用接线 + 启动只读检查 | 实际写集为 `apps/web/scripts/migrate.ts`、`apps/web/src/instrumentation.ts`、`apps/web/src/lib/db/product-migrations/{compatibility,legacy-contract}.ts`、`packages/persistence-pg/src/migrations/{runner,types}.ts`、`scripts/test-pg-local.mjs` 和 `test/domain/product-migration-cli.test.ts`。CLI 使用包内 plan、探针/takeover 编排；启动 gate 在 Sentry/Nano 初始化前接入；当前 `db:migrate`/启动产品路径不再运行时导入旧 runner/旧 SQL 模块。 | 真实 CLI 在 `n3_cli_fresh` 和旧链演练后的 `n3_cli_legacy` 上均 exit 0 并写预期账本；旧库漂移、同名 view、缺表均 fail closed，两代账本和物理对象保持。启动检查的通过库、缺表库及 journal/对象只读快照通过。2026-11-18 最终门禁为 domain 280、packages 211、零 skip/14 库；typecheck 20、lint 106 既有 warning/0 error/0 新增、routing 4、离线 engineering 4，均 exit 0；8 GiB 冷构建、兼容库 HTTP 200、缺表 exit 1。 | 修改历史迁移字节、自动迁移非本卡自建库、启动检查执行 DML/DDL 或进程在失败后继续可服务 | 实施与合成验收完成；独立 Review/提交发布以同卡回执为准 |

### P1-3 最终门禁与 Next 启动修正

2026-11-18 的终态门禁已保留历史 P1-1 domain 267、P1-2 domain 273 和 packages 211 的分段证据，并新增
P1-3 的 domain 280、packages 211；两者均只在 PG16、14 个独占合成库范围内、零 skip。真实 CLI 的新空库
和完整旧链演练后接管均退出 0 并写入预期账本；旧库结构漂移拒绝时不写 `_niu`，两代账本与物理对象保持。
兼容检查在正常库、同名 view、缺表场景使用的 journal、profile、public relation 和 enum 前后快照一致。

首轮真实 Next 16.3.3 启动验收中，临时 8 GiB 堆 Webpack 冷构建 exit 0，兼容库 HTTP 200；删除
`feedback_replies` 后检查已报告安全错误，但 Next `prepare().catch` 只记录日志，进程继续存活 30 秒。框架层
实际会先完成端口 bind 并打印 `Ready`，再运行 `instrumentation`。修正后，兼容检查的 PG 连接仍由
`finally` 释放；失败分支只输出安全错误并显式 `process.exit(1)`，不启动 Sentry/Nano，不进入可服务状态。
复验缺表时 `next start` exit 1，两张 `_niu` 元数据和缺表状态不变，测试容器已清理。8 GiB 是冷构建
workaround，E3 的默认 V8 堆内存问题仍未解决。真实依赖/环境、provider、SSO、registry、真实业务数据
和生产环境仍未验。

## 四、方案 A 已确认、回退前提与不变量

方案 A 已由用户确认（2026-11-18）。P1-1 已独立 Review 并发布到 `260f664`；P1-2 已独立 Review 并发布到
`ac42561`；P1-3 实施与合成验收已完成，独立 Review 和提交发布见同卡回执。当前停在阶段 1 整体 Review。
两份旧文档的口径已经修正：[`2026-11-11-platform-roadmap.md`](2026-11-11-platform-roadmap.md) 的阶段 1
退出条件改为“仅一个活跃权威入口，历史保留”；[`2026-11-11-nano-followups.md`](2026-11-11-nano-followups.md)
已把经批准的 `_n2` 到 `_niu` 接管移入阶段 1 并链接本设计，不再表述为等待触发。

回退前提仅限本阶段未改业务 schema 且旧应用仍接受当前数据库合同；不承诺后续任意版本重部署必可回退。

不变量：`PRODUCT_ID` 保持 `BiuBiuNiu`；既有迁移 SQL/module/meta/`legacy-reference` 字节不改；资金与
状态同事务；不读真实 `.env`/凭据；不连接非本卡自建合成 PG；不调用真实 AI/支付/SSO/registry。
PG16 指纹是本阶段测试合同，不扩展到其他 PostgreSQL 版本或生产验收。接管期间必须停用旧应用 DDL
执行入口；包内 advisory lock 不能与旧 runner 的锁域互斥。`check-db-compat.ts` 和旧 runner 只保留为
历史只读诊断/回归资产，当前产品路径不再调用旧 DDL。保留 `_n2` 账本后，重复 CLI 仍会进入 takeover 并
重新核对冻结合同；新增模块、结构变化或新指纹必须使用显式版本化接管/升级协议与独立验收，不能把当前
合同解释为对未来 schema 的自动兼容。
