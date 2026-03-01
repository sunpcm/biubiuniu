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
