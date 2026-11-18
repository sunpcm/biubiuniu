# Nexty 平台 · 当前 TODO（2026-11-18）

状态：产品开发已由用户恢复。开发分支为 `codex/nexty-platform-overnight-20261105`，实际 HEAD 以
`git rev-parse HEAD` 为准。

- 长期方向和阶段划分：[docs/plans/2026-11-11-platform-roadmap.md](docs/plans/2026-11-11-platform-roadmap.md)
- 阶段 0 历史任务卡 T1–T7：[docs/plans/2026-11-11-nano-followups.md](docs/plans/2026-11-11-nano-followups.md)

## 2026-11-11 已合并（未经独立 Review，T1、T2 验证未完成）

- Nano `unknown` 超时自动退款（默认 15 分钟，`NANO_UNKNOWN_REFUND_AFTER_MS`），停机后停止领取新任务，
  sweeper 各步隔离并记录 unknown 与退款日志。
- 稳定产品 ID 常量 `PRODUCT_ID`，取值保持 `"BiuBiuNiu"`。
- Nano 状态轮询、列表和 lease 转换不再读取输入图。
- Nano 页面的本地任务键和表单状态按 subject（团队工作区或个人）隔离。原“按 userId 隔离”一项以此完成，
  但**没有做过浏览器验证**，见任务卡 T2。
- 无计费组织可用的静态 billing 端口；`turbo run typecheck` 不再需要先手动 build。

当时的本地证据：typecheck、lint（106 个既有 warning）、`test:packages` 176 通过 / 8 项因缺 PG 变量
skip、`test:routing` 4/4、`test:engineering` 4/4（离线模式）、Nano 相关 PG 用例 55/55（自建的本地合成库，
不是主控的标准隔离库）。全量 `test:domain` 没有得到全绿结果，原因见任务卡 T1。这些是历史证据，
不代表当前 HEAD 通过。

## 阶段 0 本轮实施状态：独立 Review 已通过

本轮候选分支 `claude/phase0-hardening-20261111` 从远端开发分支 HEAD
`06fcd791f639589a146026322f1d805455d545df` 开始。本轮候选已获独立 Review `APPROVED`，
检查命令、未执行项和剩余风险见本轮交付与独立评审记录。

1. **T1：只读核查完成**。基线与候选均可复现两项 403；对齐合成 `NEXT_PUBLIC_SITE_URL`、
   `NEXT_PUBLIC_BETTER_AUTH_URL` 和请求 Origin 后均通过，未发现该两项回归；没有关闭 Origin 校验。
2. **T2：修复与浏览器自检完成，独立 Review 已通过**。按 subject 隔离已完成；为原生文件输入增加 subject key，
   换号时与提示词、预览一起清空。六项浏览器用例已实跑；沿用用户确认的禁用日语口径，
   `/ja/nano` 回默认中文页，不声明日语翻译浏览器通过。
3. **一键本地 PG 脚本：已实现并实跑，独立 Review 已通过**。入口 `pnpm test:pg:local`，本机临时 PG16，
   全部 domain/packages、零 skip 校验、仅监听 `127.0.0.1`、执行后清理；见
   [本地测试说明](docs/local-pg-tests.md)。PG18 的 RESTRICT SQLSTATE 与现有断言不同，本轮不宣称支持。
4. **T3、T4、T5：实施与自检完成，独立 Review 已通过**。gate 要求 `auth` profile；新增双链 DDL 等价守护，
   双向内存变异会失败且迁移字节未改；冻结 README 明确截至 0001，五个资源 SHA256 核对一致。
5. **T7：按任务卡“不确定就不做”，本轮不实施**。真实 SDK 的回环反例中，第一跳已收到带 body 的 POST，
   307 后第二跳仍可报 `cause.code=ECONNREFUSED`，最终错误码不足以证明请求未发出，保持 unknown 兜底。
6. **T6：文档口径已修正，独立 Review 已通过**。区分应用库/旧链参考库、domain fail/package skip、两条迁移链、
   未接入启动检查以及工程测试离线模式；“按 userId 隔离”已由本页原有 subject 完成条目取代。

实施节点未自行提交或推送。用户随后明确授权主控在独立 Review 通过后按卡提交，
只推送 `claude/phase0-hardening-20261111`；不开 PR、不合并、不部署。

## 下一步

阶段 0 独立 Review 已通过。阶段 1（参考应用改用包内迁移链，P1-D）方案 A 已于 2026-11-18 由用户确认；
P1-1 已审核发布，P1-2 已实现并通过正式合成验收，当前下一张卡为 P1-3。设计见
[阶段 1 设计](docs/plans/2026-11-17-platform-phase1-design.md)。

- **P1-1 产品 CMS/反馈迁移模块**：已完成并审核发布，基线提交为 `260f664`。产品模块以静态 SQL 复用旧链的
  5 张表、6 个枚举、13 个约束和 21 个索引；`nano_payments_cms` 装配由四个平台模块加
  `cms_feedback` 组成。
- **P1-2 接管核对 + 账本回填**：实现与合成验收已完成，独立 Review 和提交发布见本卡回执。包内
  `/migrations` 导出 `captureMigrationSchemaContract` 与 `takeoverMigrations`；公开合同固定为
  `formatVersion`、`postgresMajor`、`profile`、`modules`、`schemaHash`，完整结构类别在包内生成摘要并保留
  分项 hash 诊断。接管复用普通 runner 的默认 advisory lock、事务、账本 DDL 与写入，锁后先核完整旧
  `_n2` journal、实际结构指纹和完整 `_niu` 元数据，验证通过才允许缺失账本的首次回填；接管路径不执行
  任何 `module.statements`。半份账本、错误旧 ref、结构漂移和自定义账本名均 fail closed，旧账本与旧业务
  数据保留。正式 PG16 测试还以合成触发器令第二个元数据 DDL 报错，确认两个账本原子回滚。
- **P1-3 应用接线 + 启动只读检查**：下一张卡，未开始。

P1-2 正式验收结果：typecheck 20 个 task 通过；lint 为 106 个既有 warning、0 个 error；PG16 下 domain
273 项、packages 211 项均通过且零 skip；routing 4 项和离线 engineering 4 项通过。从包链合成参考库
生成的 PG16 结构指纹与完整旧链匹配；并发接管得到一次 applied[5]、一次 skipped[5]，重复接管与普通
runner 均保持 `_n2`、`_niu` 两代账本。临时数据库、故障注入与容器均已清理。该指纹只证明本阶段 PG16
合成合同，不声明其他 PostgreSQL 版本、真实数据或生产迁移已获验收。

接管期间必须在运维上停用旧应用 DDL 执行入口（包括旧 `db:migrate`/旧 runner 的活跃调用）。包内
advisory lock 只协调包内迁移与 takeover；旧 runner 使用不同锁域，不能假定二者会互斥。历史迁移 SQL、
module、meta 和 `legacy-reference` 仍按字节冻结，停用的是活跃执行入口，不是删除历史资产。

- **E1 管理员 credit ledger query key 统一**：独立 Review 已通过，已提交并推送（`9bc85df`）。
- **E2 Google 字体构建期下载依赖**：独立 Review 已通过并提交推送（`3f78981`），用户 Review 待。
- **E3 构建默认 V8 堆内存不足**：默认 V8 堆 OOM 已复现；单独
  `webpackMemoryOptimizations` 候选同条件仍失败，已撤回；未修，需后续剖析；不能等同
  4 GiB 容器限制。

## 等用户决定，暂时不做

- provider 返回 5xx 时是否立即退款（取决于 provider 计费口径）。
- 输入图和结果图的保留期；结果图迁出 PG 行。
- 团队工作区内成员能否互相查看、取消任务。
- 第二个产品先要哪些能力（决定路线图阶段 2、3 的范围）。

## 外部待验（四组全部未验，P6 不推进）

| 组            | 需 owner 提供                                                                            |
| ------------- | ---------------------------------------------------------------------------------------- |
| AI / 支付     | 具体 sandbox、key 引用、费用调用授权                                                     |
| SSO 消费者    | 合同/精确回调、PKCE/state/撤销、角色刷新退出；需受维护的 OAuth/OIDC 协议实施，不只是联调 |
| 真实 registry | 精确版本/tag、权限、独立消费者、上传授权；本地 Verdaccio 不等于真实发布                  |
| D1b 数据      | 授权脱敏快照、最终映射、旧 Schema 和包版本、升级回退演练范围                             |

不臆造日期或外部授权。不合并到 `main`、不部署、不做生产迁移、不调用真实 provider 或 registry。
