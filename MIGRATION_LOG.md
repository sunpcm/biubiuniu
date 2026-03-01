# 迁移日志 (Migration Log)

记录从 `nexty.dev` 单体项目向 `biubiuniu` Monorepo 迁移的所有操作。

## Phase 1: 基础设施骨架搭建与核心包抽离

### 开始日期: 2026-03-01

### 步骤记录

| 步骤                      | 状态 | 说明                                                                           |
| ------------------------- | ---- | ------------------------------------------------------------------------------ |
| S0 - 创建追踪文档         | 完成 | 创建 MIGRATION_LOG.md 和 ENHANCE_LOG.md                                        |
| S1 - 清理演示代码与旧包   | 完成 | 删除 apps/vite-app, apps/webpack-app, packages/ui-lib                          |
| S2 - @biu/ → @niu/ 重命名 | 完成 | 15 个文件中的 @biu/ 全部替换为 @niu/                                           |
| S3 - 更新 pnpm catalog    | 完成 | 添加 Next.js、UI 组件、数据库等 20+ 依赖到 catalog                             |
| S4 - 扩展 tsconfig        | 完成 | 新建 nextjs.json 预设（extends react.json）                                    |
| S5 - 扩展 eslint-config   | 完成 | 新建 next.js 预设（ESLint v9 Flat Config + FlatCompat 回退）                   |
| S6 - 更新 tailwind-config | 完成 | 用 nexty.dev 的完整 shadcn OKLCH 主题替换简单 brand 色彩                       |
| S7 - 创建 @niu/utils      | 完成 | 提取 cn() 函数到独立包                                                         |
| S8 - 创建 @niu/ui         | 完成 | 迁移 57 个 shadcn 组件，修复 52 个文件的 cn 导入 + 20 处组件互引               |
| S9 - 设置 apps/web        | 完成 | 创建 package.json/tsconfig/eslint/postcss/next.config/drizzle.config，复制源码 |
| S10 - 导入路径与品牌替换  | 完成 | 107 个文件 UI 导入替换，11 个文件品牌替换                                      |
| S11 - 更新根配置          | 完成 | turbo.json 添加 .next 输出, .gitignore 添加 .next                              |
| S12 - 验证                | 完成 | pnpm install 通过, typecheck 通过, build 通过                                  |

### S12 验证期间发现并修复的问题

| 问题                                                        | 修复方式                                 | 涉及文件 |
| ----------------------------------------------------------- | ---------------------------------------- | -------- |
| `badge-1.tsx` 和 `choicebox-1.tsx` 直接导入 `clsx`          | 替换为 `import { cn } from "@niu/utils"` | 2        |
| `proxy.ts` 导入 `./i18n/routing` 路径错误                   | 修正为 `./src/i18n/routing`              | 1        |
| `tiptap/` 组件使用相对路径 `../ui/` 导入 UI 组件            | 替换为 `@niu/ui/` 前缀                   | 2        |
| `GoogleAnalytics.tsx` 的 `gtag.js` 相对路径层级不对         | `../../gtag.js` → `../../../gtag.js`     | 1        |
| Better Auth `admin()` 插件的 `user.role` 类型推断不通过 tsc | 添加 `as { role?: string }` 类型断言     | 5        |

### 品牌替换记录

| 原始值                           | 替换为                               | 上下文            | 涉及文件数 |
| -------------------------------- | ------------------------------------ | ----------------- | ---------- |
| `@biu/*`                         | `@niu/*`                             | 包作用域命名      | 15         |
| `@/components/ui/*`              | `@niu/ui/*`                          | UI 组件导入路径   | 107        |
| `@/lib/utils` (cn)               | `@niu/utils`                         | UI 包内 cn 导入   | 52         |
| `@/components/ui/xxx`            | `./xxx`                              | UI 包内组件互引   | 12         |
| `LogoNexty`                      | `LogoNiu`                            | React 组件名      | 1          |
| `NEXTY.DEV`                      | `BiuBiuNiu`                          | 品牌标题/文案     | 8          |
| `Nexty`                          | `Niu`                                | 功能描述/推荐文案 | 8          |
| `https://nexty.dev`              | `https://biubiuniu.com`              | URL 域名          | 8          |
| `https://demo.nexty.dev`         | `https://demo.biubiuniu.com`         | 子域名 URL        | 6          |
| `https://docs.nexty.dev`         | `https://docs.biubiuniu.com`         | 文档站 URL        | 3          |
| `https://flux-kontext.nexty.dev` | `https://flux-kontext.biubiuniu.com` | 产品子域名        | 6          |
| `nexty-flux-kontext`             | `niu-flux-kontext`                   | 产品名称          | 6          |
| `nexty-directory`                | `niu-directory`                      | 产品名称          | 6          |
| `NEXTY_WELCOME_SHOWN`            | （已在新 next.config.mjs 中移除）    | 环境变量          | 1          |

### 未替换项（有意保留）

| 保留内容                          | 原因                       |
| --------------------------------- | -------------------------- |
| `config/site.ts` 中的 `BiuBiuNiu` | 原始文件已经使用正确品牌名 |
| 第三方包名/API endpoint           | 非自有标识，不应替换       |

---

## Phase 2: 核心服务抽取 (Core Service Extraction)

### 开始日期: 2026-03-01

### 步骤记录

| 步骤                           | 状态 | 说明                                                                                 |
| ------------------------------ | ---- | ------------------------------------------------------------------------------------ |
| S1 - 创建 @niu/db 包           | 完成 | 新建 packages/db，含 schema.ts, config.ts, index.ts, drizzle.config.ts, seed/        |
| S2 - 替换 @/lib/db 导入        | 完成 | 75 个文件、105 处导入从 `@/lib/db` → `@niu/db`，`@/lib/db/schema` → `@niu/db/schema` |
| S3 - 清理 apps/web 数据库残留  | 完成 | 删除 `apps/web/src/lib/db/` 目录和 `apps/web/drizzle.config.ts`                      |
| S4 - 扩展 @niu/utils           | 完成 | 添加 formatCurrency, formatBytes, formatValue, kebabToPascalCase 到共享包            |
| S5 - 全量替换 @/lib/utils 导入 | 完成 | 23 个文件从 `@/lib/utils` → `@niu/utils`，无桥接层                                   |
| S6 - 删除 utils.ts 桥接文件    | 完成 | 移除 `apps/web/src/lib/utils.ts`                                                     |
| S7 - 创建 @niu/mail 包         | 完成 | 8 个邮件模板迁移到 packages/mail，siteConfig 改为 Props 注入                         |
| S8 - 更新邮件模板消费者        | 完成 | 3 个消费者文件改为从 `@niu/mail` 导入并传递 `site` prop                              |
| S9 - 清理 apps/web 邮件残留    | 完成 | 删除 `apps/web/src/emails/` 目录                                                     |
| S10 - 更新 apps/web 依赖       | 完成 | 添加 @niu/db, @niu/mail 依赖；移除 postgres, pg, drizzle-kit, @types/pg              |
| S11 - 验证                     | 完成 | pnpm install 通过, typecheck 5包全部通过, build 通过                                 |

### 新增包一览

| 包名        | 路径          | 用途                                         | exports                     |
| ----------- | ------------- | -------------------------------------------- | --------------------------- |
| `@niu/db`   | packages/db   | Drizzle ORM schema、连接池配置、数据库实例   | `.`, `./schema`, `./config` |
| `@niu/mail` | packages/mail | 8 个 React 邮件模板，通过 Props 注入站点信息 | `.`                         |

### 导入路径替换记录

| 原始路径          | 替换为           | 涉及文件数 |
| ----------------- | ---------------- | ---------- |
| `@/lib/db`        | `@niu/db`        | 32         |
| `@/lib/db/schema` | `@niu/db/schema` | 73         |
| `@/lib/db/config` | `@niu/db/config` | 1          |
| `@/lib/utils`     | `@niu/utils`     | 23         |
| `@/emails/*`      | `@niu/mail`      | 3          |

### 架构决策记录

| 决策点                     | 选择                      | 理由                                                  |
| -------------------------- | ------------------------- | ----------------------------------------------------- |
| api-response.ts 处理       | 保留在 apps/web           | 与 Next.js Route Handler 强耦合，不适合下沉到纯逻辑包 |
| drizzle.config.ts 处理     | 迁移到 packages/db        | 数据库包自包含，独立管理 generate/push/studio         |
| lib/utils.ts 桥接层策略    | 全量替换，不保留桥接      | 长痛不如短痛，直接替换所有 23 处导入                  |
| 邮件模板 siteConfig 注入   | Props 参数注入            | React 纯函数思想，避免全局变量，Serverless 友好       |
| formatCurrency process.env | 改为 defaultCurrency 参数 | 共享包不应依赖 process.env，保持运行环境无关性        |
