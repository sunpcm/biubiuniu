# Migration 活跃入口、历史链与兼容边界

本文记录截至 2026-11-18 的迁移入口和已验证边界。P1-1、P1-2 已独立 Review 并发布；P1-3 实施与合成
验收通过，独立 Review 和提交发布状态以同卡回执为准。阶段 1 后续停在整体 Review，PR 由用户创建。
包内模块/profile 合同见
[`platform-architecture.md` §6](platform-architecture.md#6-migration-profile-与数据库合同)。

## 当前权威入口

`apps/web/package.json` 的唯一活跃产品迁移入口仍是：

```bash
pnpm --filter @niu/web db:migrate
```

它执行 `tsx apps/web/scripts/migrate.ts`，读取显式 `DATABASE_URL`，不自行加载 `.env`，也不从本地配置
兜底。当前 CLI 不再 import 应用内旧 `_n2` runner 或旧 SQL 模块；实际编排为：

1. 以单连接只读查询 `current_database()`、`current_user()` 和
   `to_regclass('public._n2_migration_journal')`，先核对连接身份，查询结束在 `finally` 中关闭连接。
2. 新空库或只有原生 `_niu` 元数据的库调用包内 `runMigrations`，使用 `PRODUCT_MIGRATION_PLAN` 的
   `nano_payments_cms` profile、五个模块和固定根集。
3. 存在 `_n2_migration_journal` 的旧库调用包内 `takeoverMigrations`，核对 P1-2 冻结的 PG16 结构合同
   和三条旧 journal 身份；通过后只回填 `_niu` 账本，不执行 `module.statements`。
4. 失败只输出固定安全错误，不打印连接串或数据库内容，并以 exit 1 结束。

`apps/web/scripts/check-db-compat.ts` 与应用内旧 runner 仍作为历史只读诊断/回归资产保留，不是当前
`db:migrate` 的活跃写入口。历史迁移 SQL、meta、module 和 `legacy-reference` 继续按字节冻结。

## 启动 gate

真实 Node 服务通过 `apps/web/src/instrumentation.ts` 的 `instrumentation.register()` 接入只读
`assertProductDatabaseCompatibility()`。它在 Sentry 和 Nano runtime 启动前运行，核对 `_niu` journal、
逐模块精确 `contract_version`、`_niu_migration_profile` 中的 `nano_payments_cms` activation、产品固定
5 表/6 enum sentinel 以及物理 schema；所有表 sentinel 都要求 public `relkind` 为 `r` 或 `p`，同名 view
不算表。检查只执行 SELECT，并由 `finally` 关闭 PG 连接。

`NEXT_PHASE=phase-production-build` 与 `phase-export` 不触发该业务数据库 gate；edge 分支保持原有 Sentry
接线。真实 Node server 的 build/export 判定复用现有 bootstrap phase 语义。

首轮 Next 16.3.3 实测曾发现：缺 `feedback_replies` 时检查已经报告安全错误，但 Next
`prepare().catch` 只记录日志，进程继续存活 30 秒。修正后失败分支保留脱敏诊断并显式
`process.exit(1)`，兼容性失败使进程 exit 1，不启动 Sentry/Nano，不进入可服务状态。Next 框架层会先完成
端口 bind 并打印 `Ready`，随后执行 `instrumentation`，所以这里不承诺失败前尚未 bind。复验结果为兼容
库 HTTP 200、缺表时 exit 1，且两张 `_niu` 元数据和缺表状态不被修改。

## 历史 N2 `_n2` 链

以下语义仅描述历史 N2 `_n2` 资产和旧链测试，不再描述当前 `db:migrate`：

- `apps/web/src/lib/db/migration-types.ts` 定义旧文件、source、report 和 runner options。
- `apps/web/src/lib/db/migration-source.ts` 严格消费冻结 `meta/_journal.json`，计算语句流 checksum
  与 raw checksum；缺/坏 meta、缺 SQL、重复身份和异常 tag path 均失败。
- `apps/web/src/lib/db/migration-runner.ts` 在单事务内获取旧 `_n2` advisory lock、校验 guard、建
  `_n2_migration_journal`、执行历史 DDL、写账本并验证旧 sentinel。
- `test/domain/migration*.test.ts` 与部分 legacy/takeover fixture 继续使用该历史链；它们不恢复旧 runner
  作为应用产品入口。

历史 checksum 身份是 drizzle 语句流 hash，另保存 raw 字节 hash 作补充；`_n2` 账本只记录语句流
checksum。历史两条/三条 SQL 的文件名、tag、meta 和 raw bytes 始终原样读取，不补写、改名或删除。

## 旧库切换边界

包内 advisory lock 只协调包内普通迁移与 takeover，旧 runner 使用不同锁域，二者不能假定互斥。对共享
旧库执行接管前，运维必须先停用旧应用 DDL 执行入口，包括历史 `db:migrate`/旧 runner 的任何活跃调用。
停用的是活跃写路径，不是删除历史资产。

当前 P1-2 结构合同冻结为 PG16 合成验收合同。保留 `_n2_migration_journal` 后，后续重复执行
`db:migrate` 仍会进入 takeover 分支并重新核对同一冻结合同；这不是“自动兼容未来 schema”的承诺。
新增模块、改变产品结构或改变冻结指纹都需要显式、版本化的接管/升级协议与新的独立验收，不能直接扩展
当前合同或放宽校验。

## 测试与验收

`pnpm test:pg:local` 创建 14 个独占 PG16 合成库，串行执行全部 domain/package PG 用例并拒绝 skip。
P1-3 最终门禁为 domain 280、packages 211、零 skip，14 库，exit 0；typecheck 20、lint 106 个既有
warning/0 error/0 新增、routing 4、离线 engineering 4 也均 exit 0。真实 CLI 在新空库和旧链演练后均
exit 0 并写入预期账本；结构漂移时 exit 1 且两代账本/物理对象不变。临时库、故障注入和容器均已清理。

同一时点的 Webpack 冷构建使用临时 8 GiB 堆通过，兼容库 `next start` HTTP 200、缺产品表时 exit 1；
这验证了当前合成应用路径，不代表真实依赖/环境、provider、SSO、registry、真实业务数据、生产迁移或
其他 PostgreSQL 版本。E3 的默认 V8 堆内存问题仍未解决，8 GiB 只是验收 workaround。
