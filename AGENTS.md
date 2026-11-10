# Nexty 平台项目规则

本文件适用于存放它的 Git 仓库及子目录。跨会话恢复开发时，先读
[`HANDOFF.md`](HANDOFF.md)、[`TODO.md`](TODO.md)、
[`docs/platform-architecture.md`](docs/platform-architecture.md)、
[`docs/plans/2026-11-04-nexty-platform-migration.md`](docs/plans/2026-11-04-nexty-platform-migration.md)
和 [`docs/agent-review-loop.md`](docs/agent-review-loop.md) 的当前状态。所有沟通和交付文档使用中文。

## 工作边界

- 用户当次任务显式指定且已经授权的仓库或 worktree 继续有效，无需重复索取同一路径的确认。
  从本文件所在仓库或 worktree 使用相对路径定位；不要把旧会话的本机绝对路径写入项目规则。
- 只修改任务明确授权的写集。实施节点禁止读取和修改主控评审探针及未授权 `reviewer` 目录；
  来源 checkout 和其他产品区域保持只读。这是协作行为边界，不代表操作系统权限隔离。
- 保留既有 tracked WIP 和经过说明的 untracked 文件，不执行 `git clean`、`git stash`、
  `git reset` 或覆盖式重建。来源仓库更新不自动改变已经固定的迁移基线。
- 任务显式指定的交付报告可以位于产品仓外，按该路径写入且不自动纳入产品提交。主控的基线清单、
  检查脚本、验收 manifest、评审结论和预算不由实施节点修改。
- 禁止读取或复制真实 `.env`、凭据、用户数据、会话材料或数据库卷；需要配置时只使用宿主提供的
  安全注入和 `apps/web/.env.example` 中的变量名。

## 实施与评审

- 实施与独立评审分离。主控负责架构、范围裁决、独立 Review 和按授权提交；实施节点负责授权内的
  修改和自检，不能批准自己的交付，也不能自行 `commit`、`push`、`merge` 或发布。
- 边界明确的小改动采用轻量交接：给出改了什么、白名单写集、自检命令与结果、未执行项和剩余风险，
  然后停在 Review。只有任务明确要求时才编写冗长过程文档。
- 用户已经明确且范围一致的授权持续有效；实施节点应按授权直接推进已有动作，不为同一范围重复
  请示。`push`、真实依赖调用、部署、生产迁移等与原授权不同的动作不自动随附，仍需当次具体授权。
- 当前产品 TODO 在文档接续任务中保持暂停，不得顺手实施 P2。恢复产品工作必须有新的明确指令。
- 技能、模型、MCP、浏览器和其他工具路由以实际宿主能力和用户当次策略为准；不要假设云端会同步
  本机技能、模型别名、会话或 MCP，也不要为迁移文档编排尚未核实的云端能力。

## 运行与验收

- 目标运行时为 Node `24.15.0`、pnpm `10.26.0`。运行前实际核对
  `node --version` 和 `pnpm --version`；安装使用 `HUSKY=0 pnpm install --frozen-lockfile`，
  不安装共享 Git hooks，不使用 `NODE_PATH`、手工 symlink 或临时 tsconfig 伪造模块解析。
- PostgreSQL 验证只使用新创建的隔离合成库和合成数据，不连接或迁移生产库。精确测试变量、
  身份 guard 和迁移边界以 [`docs/agent-review-loop.md`](docs/agent-review-loop.md) 与
  [`docs/migrations-canonical.md`](docs/migrations-canonical.md) 为准；缺少变量导致 skip
  时不能报告全通过。
- 所有并行 writer 完成写入并停手后，才串行执行源码变异、PG、build、全树 typecheck 和 root
  engineering 检查。源码变异期间不得并行运行同一工作树上的 build、typecheck 或其他读取检查。
- 交付状态分项记录本地静态检查、本地测试、独立 Review、外部依赖、提交、push 和部署。历史报告、
  mock、合成 fixture、skip 和未执行项都不能提升为当前源码或线上整体通过。
- 构建默认 4 GiB OOM 仍是待办；临时 8 GiB 通过不表示默认内存问题已修复。Google 字体构建下载
  依赖、安装和根测试的网络需求在实际执行前核实，不能自动发起真实业务调用。
