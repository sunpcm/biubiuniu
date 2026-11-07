# 增强日志 (Enhancement Log)

记录迁移过程中对原始基础设施进行的非迁移性改进。

## 改进列表

| 改进项                            | 阶段          | 说明                                                                                                                                                                                                 |
| --------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint v9 Flat Config for Next.js | Phase 1 (S5)  | nexty.dev 原用旧式 .eslintrc.js (extends 格式)，升级为 ESLint v9 Flat Config 格式，创建 `@niu/eslint-config/next` 子路径导出，支持 flat 导入和 FlatCompat 回退                                       |
| Next.js TypeScript 预设           | Phase 1 (S4)  | 新增 `@niu/tsconfig/nextjs.json`，extends react.json，添加 Next.js 优化配置（target ES2017、incremental、next 插件）                                                                                 |
| Next.js 依赖纳入 pnpm catalog     | Phase 1 (S3)  | 将 Next.js 核心依赖及 UI 组件依赖的版本统一管理到 pnpm-workspace.yaml 的 catalog 中                                                                                                                  |
| Tailwind 主题升级                 | Phase 1 (S6)  | 将简单的 brand 色彩主题升级为完整的 shadcn/ui 设计系统（OKLCH 色彩空间、亮暗双主题、动画、阴影系统等）                                                                                               |
| turbo.json 扩展                   | Phase 1 (S11) | build outputs 添加 `.next/**`，inputs 添加 `next.config.*`、`drizzle.config.*`                                                                                                                       |
| .gitignore 扩展                   | Phase 1 (S11) | 添加 `.next/` 到构建输出忽略列表                                                                                                                                                                     |
| ESLint 错误全面修复               | Phase 1.5     | 修复 165 个 ESLint 错误（详见下方），typecheck / lint / build 三项全部通过                                                                                                                           |
| lint 脚本适配 Next.js 16          | Phase 1.5     | `next lint` 在 Next.js 16 已移除，改为 `eslint src --report-unused-disable-directives`；移除 `@niu/eslint-config/next` 依赖（FlatCompat 与 eslint-config-next 存在循环引用）                         |
| ESLint 规则调优                   | Phase 1.5     | 关闭 `react/prop-types`、`react/display-name`、`react/no-unescaped-entities`（TypeScript 项目中冗余）；配置 `no-unused-vars` 识别 `_` 前缀约定；添加 `react/no-unknown-property` 对 `jsx` 属性的豁免 |

## Phase 1.5 修复明细

**修复的 ESLint 错误类别（共 165 → 0）：**

| 错误规则                                   | 数量 | 修复方式                                                             |
| ------------------------------------------ | ---- | -------------------------------------------------------------------- |
| `@typescript-eslint/no-unused-vars`        | ~50  | 删除未使用的 import、catch 参数加 `_` 前缀、移除无副作用的未使用赋值 |
| `react/no-unescaped-entities`              | ~40  | 在 `@niu/eslint-config` 中全局关闭（法律页面和邮件模板）             |
| `react/prop-types`                         | ~13  | 在 `@niu/eslint-config` 中全局关闭（TypeScript 已覆盖）              |
| `prefer-const`                             | ~9   | `let` → `const`（不涉及后续赋值的变量）                              |
| `no-case-declarations`                     | 4    | switch/case 块添加 `{}` 作用域（`lib/email.ts`）                     |
| `react-hooks/rules-of-hooks`               | 3    | 将条件判断移入 hook 内部（`CrispChat.tsx`、`PostHogProvider.tsx`）   |
| `@typescript-eslint/ban-ts-comment`        | 3    | `@ts-ignore` → `@ts-expect-error`（Tiptap 编辑器）                   |
| `no-empty`                                 | 3    | 空 catch 块添加 `// intentionally empty`                             |
| `no-useless-escape`                        | 2    | 移除正则中不必要的转义                                               |
| `react/no-children-prop`                   | 2    | 改为 JSX children 语法（`badge-1.tsx`）                              |
| `no-constant-binary-expression`            | 1    | 修复 `Number() ?? undefined` 逻辑（`PricePlanForm.tsx`）             |
| `@typescript-eslint/no-require-imports`    | 1    | `require()` → 动态 `import()`（`LanguageDetectionAlert.tsx`）        |
| `@typescript-eslint/no-empty-object-type`  | 1    | 空 interface → type alias（`rainbow-button.tsx`）                    |
| `react/jsx-no-target-blank`                | 1    | 添加 `rel="noreferrer"`                                              |
| `react/no-unknown-property`                | 1    | 在 config 中豁免 `jsx` 属性                                          |
| `@typescript-eslint/no-unused-expressions` | 1    | 删除孤立字符串表达式（`stripe-error/page.tsx`）                      |
| 其余零散                                   | ~30  | 见上方分类                                                           |

**保留的 warnings（不阻塞提交）：**

- `@typescript-eslint/no-explicit-any`: 199 个（`warn` 级别，留待后续逐步补全类型）
- `react-hooks/exhaustive-deps`: ~12 个（暂不修改，避免运行时行为变化）

---

## Phase 2 改进

| 改进项                  | 阶段          | 说明                                                                                                                               |
| ----------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| formatCurrency 环境解耦 | Phase 2 (S4)  | `formatCurrency` 原依赖 `process.env.NEXT_PUBLIC_DEFAULT_CURRENCY`，改为 `defaultCurrency` 参数，消除共享包对 Node.js 运行时的依赖 |
| 邮件模板 Props 化       | Phase 2 (S7)  | 所有邮件模板原直接导入 `siteConfig`，改为通过 Props 注入 `site: SiteInfo`，符合 React 纯函数思想，Serverless 友好                  |
| DB 包自包含化           | Phase 2 (S1)  | 数据库 schema/config/seed/migrations/drizzle.config 全部内聚到 `@niu/db` 包，db:generate/push/studio 命令由包自身管理              |
| apps/web 依赖精简       | Phase 2 (S10) | 从 apps/web 移除直接 DB 驱动依赖（postgres, pg, @types/pg, drizzle-kit），改为通过 @niu/db 间接依赖                                |

---

## Phase 3 改进

| 改进项                       | 阶段         | 说明                                                                                                                                              |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth 依赖注入工厂模式        | Phase 3 (S3) | 原 auth/index.ts 硬编码所有依赖（siteConfig/sendEmail/tracking/redis），重构为 createAuth() 工厂函数通过参数注入，实现 IoC 解耦                   |
| Auth 客户端工厂封装          | Phase 3 (S4) | 原 auth-client.ts 硬编码配置，提取为 createBetterAuthClient() 工厂函数，消费端一行代码实例化                                                      |
| Redis 存储接口抽象           | Phase 3 (S2) | 定义 RedisStorage 接口（get/set），避免 @niu/auth 硬依赖 @upstash/redis，支持任意兼容 Redis 实现                                                  |
| apps/web auth 层代码精简     | Phase 3 (S7-S9) | auth/index.ts 从 214行精简至 26行，auth-client.ts 从 33行精简至 3行，server.ts 从 30行精简至 9行，总计减少 239行                                    |
