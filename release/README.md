# 发布清单与许可边界

`packages.json` 按包名排序列出当前工作树中 10 个 `@sunpcm`、非 `private` 的包及其仓库相对目录。清单故意不保存版本、依赖、peer 范围和其他随实现变化的字段；选择发布批次时，以当时各包的 `package.json` 为准，并逐项检查实际 manifest 与打包产物。

## 清单的作用与限制

此清单只界定**可以进入本地打包检查**的包集合。它不授权向任何 registry 对外发布，不表示已生成或核验 tarball，不表示 P5 私有发布或独立消费项目验收通过，也不构成对包可见性、scope 所有权、上传凭据或消费者读取权限的确认。按计划 §8.3–8.5 / P5，打包检查之后仍有本地隔离消费、私有预览回读、跨仓库消费与稳定发布等独立门槛。

列入清单也不改写包的许可。当前 manifest 中 `license` 字段既有 `ISC` 也有 `UNLICENSED`；部分包的 `files` 还包含 `NOTICE`。迁移计划 §8.3 明确要求发布前确认上游模板与案例素材的复用及再分发范围，不能把生成器留下的 `ISC` 自动当作所有迁入内容的许可，不能把 `license: UNLICENSED` 改成 `ISC`，也不能通过改写或删除 `NOTICE` 将其变成 `ISC`。真实私有权限与再分发许可仍待确认，未确认前不能据此推进真实发布。

## 兼容集合与依赖闭包

9 个业务包与可独立发布的 `@sunpcm/niu-prettier-config` 当前版本均为 `0.1.0-next.0`，但可以选择不同的兼容集合和发布批次，不要求所有包一直同版本或同时发布。每次选择批次都要从所选包当前 manifest 展开内部依赖闭包，确认闭包中的 `@sunpcm` 包都进入同一批或有已验证的兼容版本，并核对 peer 范围、数据库兼容区间与产物完整性。`@sunpcm/niu-persistence-pg` 声明了对 Auth、Commerce、Contracts、Feature Nano 的内部依赖，而 Feature Nano 又依赖 Commerce；这是检查闭包时必须遵循的现有事实。

数据库合同版本来自实现中的 `DATABASE_CONTRACT_VERSION`，当前为 `1`。canonical SQL journal 的条目数不是合同版本号；发布记录中的数据库兼容范围需与该实现及实际迁移 profile 一起核对，不能用条目数替代。

## 排除与打包内容

根仓库、`apps/*`、Mail、配置目录中不属于 `@sunpcm` 的包、fixtures 与 templates 都不在此清单内。初版盘点发现 `packages/mail` 和 4 个 `@niu` 内部配置包（eslint、postcss、tailwind、tsconfig）缺少 `private: true`，该原始发现保留在初版 `report.md`。本次返工已按计划 §8.3 为这 5 个内部包补齐 `private: true`，并让既有工程测试读取本清单检查所有实际 workspace 非 allowlist 内部包必须私有；root 与 `apps/*`、`fixtures/*`、`templates/*` 的明确私有要求仍独立保留，清单不能豁免它们。后续发布仍须按本清单逐名准入，避免用工作区通配符批量选择。每个包的 `files` allowlist 与固定 registry、所有者、版本及目标 URL 仍需在发布作业时逐项核对。

产品配置、品牌与定价、模型 ID、域名、案例素材、真实 `.env`、凭据、缓存、日志、数据备份和开发测试数据库不得进入包。必要的迁移资源、文档和来源声明才可随包保留。计划 §8.1 要求检查最终 manifest 中没有 `catalog:`、`workspace:`、`link:`、仓库外 `file:` 等未解析引用，且消费者不依赖工作区源码路径、symlink 或跨仓库 alias。

本清单是静态边界文档，不定义发布命令；后续流水线须按本清单逐名核对实际磁盘 manifest 及计划中的发布门禁，不能把清单本身当成唯一事实来源。
