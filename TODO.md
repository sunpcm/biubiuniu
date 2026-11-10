# Nexty 平台迁移 · 当前 TODO（2026-11-10）

状态：文档收尾完成后暂停，停在 Review。PUSH 由主控执行，本文不记录 push 结果。

- worktree：`/Users/sunpcm/code/nexty_monorepo/.worktrees/platform-overnight-20261105`，分支 `codex/nexty-platform-overnight-20261105`，实施基线 HEAD `709dbb70`。
- 已批准状态：N1–N3、N5 本地批准；N4 本地登录态合成浏览器批准，整体真实外部门槛未批准。
- 根回归基线：448/448 零 skip；force 静态 22/22 与临时 8GB 默认 Webpack 通过（106 个既有 warnings）。所有服务、浏览器与 14 个任务容器均已停止，会话 0，数据库卷与样本保留。

## 本地待办（低风险优先，均未开始，本轮不实施）

1. **NANO_LOCAL_TASK_KEY 按 userId 隔离**：换号旧键会触发 404，服务端拒绝且无旧历史泄露；需明确旧键迁移/退出清理语义，并回归 pending→ready、退出、换号、晚响应。
2. **管理员 credit ledger query key 统一**：两处同字面量统一复用；不改财务计算契约。
3. **构建警告与默认内存**：既有 manifest/preload 警告、Google 字体构建下载依赖、默认 4GB 历史 OOM，按证据评估必要性；临时 8GB 通过不等于默认 OOM 修复，不盲加设施。

## 外部待验（四组全部未验，P6 不推进）

| 组 | 需 owner 提供 |
| -- | -- |
| AI / 支付 | 具体 sandbox、key 引用、费用调用授权 |
| SSO 消费者 | 合同/精确回调、PKCE/state/撤销、角色刷新退出；需受维护的 OAuth/OIDC 协议实施，不只是联调 |
| 真实 registry | 精确版本/tag、权限、独立消费者、上传授权；本地 Verdaccio 不等于真实发布 |
| D1b 数据 | 授权脱敏快照、最终映射、旧 Schema 和包版本、升级回退演练范围 |

不臆造日期或外部授权。

## 恢复顺序

用户明确恢复后：只读核对 HEAD/dirty/index 与实际资源归属 → 沿用四模型池（workbuddy/deepseek-v4-pro、workbuddy/deepseek-v4.1-flash、zcode/GLM-5.3、zcode/GLM-5.3-Flash；四路实际皆有问题才内置 GPT，自主检测恢复切换）→ 选一项本地 P2 轻量实施并独立 Review → 外部组在具体合同输入/授权满足后按依赖推进。

禁止把已完成本地验证重跑当作进度；不合并、不部署、不生产迁移、不真实 provider/registry 写入；恢复后 push 按当次具体授权，本轮 PUSH 不构成永久发布授权。

## 链接

- [实施计划（含 2026-11-10 实施状态）](docs/plans/2026-11-04-nexty-platform-migration.md)
- [外部验收入口](docs/external-acceptance.md)
