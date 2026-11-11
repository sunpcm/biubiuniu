# Nexty 平台 · 当前 TODO（2026-11-11）

状态：产品开发已由用户恢复。开发分支为 `codex/nexty-platform-overnight-20261105`，实际 HEAD 以
`git rev-parse HEAD` 为准。

- 长期方向和阶段划分：[docs/plans/2026-11-11-platform-roadmap.md](docs/plans/2026-11-11-platform-roadmap.md)
- 当前阶段（阶段 0）的任务卡 T1–T7：[docs/plans/2026-11-11-nano-followups.md](docs/plans/2026-11-11-nano-followups.md)

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

## 接下来按顺序做

1. **T1**：确认 `auth-http.test.ts` 两项 403 失败是环境问题还是回归（只读）。
2. **T2**：浏览器验证 Nano 页面改动（需要登录态合成环境；没有浏览器能力就留空，不要用读代码代替）。
3. **一键本地 PG 测试脚本**：起临时合成库、注入测试变量、跑 PG 用例、停库。阶段 0 的退出条件是
   一条命令跑完全部 PG 用例且零 skip。
4. **T3–T5、T7**：release gate 加 `auth` profile、DDL 等价守护测试、`legacy-reference` README、
   连接建立前的网络失败改判。
5. **T6**：文档口径修正。
6. 阶段 0 完成后，进入路线图阶段 1（参考应用改用包内迁移链）。**阶段 1 先出一页设计说明并经用户确认，
   再拆卡实施。**

仍待评估、未排期：管理员 credit ledger 的 query key 统一；构建默认 4 GiB 内存不足（临时 8 GiB 通过
不等于修复）；Google 字体的构建期下载依赖。

## 等用户决定，暂时不做

- provider 返回 5xx 时是否立即退款（取决于 provider 计费口径）。
- 输入图和结果图的保留期；结果图迁出 PG 行。
- 团队工作区内成员能否互相查看、取消任务。
- 第二个产品先要哪些能力（决定路线图阶段 2、3 的范围）。

## 外部待验（四组全部未验，P6 不推进）

| 组 | 需 owner 提供 |
| -- | -- |
| AI / 支付 | 具体 sandbox、key 引用、费用调用授权 |
| SSO 消费者 | 合同/精确回调、PKCE/state/撤销、角色刷新退出；需受维护的 OAuth/OIDC 协议实施，不只是联调 |
| 真实 registry | 精确版本/tag、权限、独立消费者、上传授权；本地 Verdaccio 不等于真实发布 |
| D1b 数据 | 授权脱敏快照、最终映射、旧 Schema 和包版本、升级回退演练范围 |

不臆造日期或外部授权。不合并到 `main`、不部署、不做生产迁移、不调用真实 provider 或 registry。
