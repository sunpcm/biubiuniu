# Modern React Monorepo Template

这是 Nexty 平台改造所基于的 Monorepo。当前平台开发请先阅读
[远端开发交接](HANDOFF.md)、[架构说明](docs/platform-architecture.md) 和 [当前 TODO](TODO.md)。
下文关于模板、`vite-app`、`packages/configs` 等示例保留为历史来源说明，不代表当前 Nexty
平台的应用结构或开发入口。

🚀 **Monorepo 模板** | 基于 Turborepo + pnpm Workspaces 构建

这是一个集成了前端生态最新标准的高性能 Monorepo 模板。是一套关于**配置管理**、**依赖治理**和**架构分层**的实践集合。

## ✨ 核心特性 (Why this repo?)

本项目采用了目前最前沿的技术栈组合，解决了传统 Monorepo 的常见痛点：

- **⚡️ 极速构建 (Turborepo)**: 智能任务编排与远程缓存，支持增量构建与按需执行。
- **📦 依赖治理 (pnpm Catalog)**: 使用 pnpm 9.x 的 `catalog:` 特性，在根目录统一管理 React, TypeScript, Tailwind 等核心依赖版本，彻底消灭“版本不一致”问题。
- **🎨 下一代样式 (Tailwind CSS v4)**: 采用 **CSS-first** 架构，利用原生 CSS 变量和 `@theme` 指令管理设计系统，摒弃复杂的 JS 配置。
- **🛡️ 现代工程化 (ESLint v9)**: 全面拥抱 **Flat Config**，配合 Prettier、Husky 和 Lint-staged，提供极致的代码规范保护。
- **🧩 架构分层 (App as Shell)**: 提倡“应用即壳，业务下沉”的架构模式，实现业务逻辑的极致复用。

## 🏗️ 架构概览

```text
.
├── apps/                   # 【应用层】(组装车间)
│   ├── vite-app/           # 基于 Vite 的应用壳子
│   └── webpack-app/        # 基于 Webpack 5 的应用壳子
│
├── packages/               # 【依赖层】(零件工厂)
│   ├── ui-lib/             # 共享 UI 组件库 (无业务逻辑)
│   └── configs/            # 【配置中心】(Single Source of Truth)
│       ├── eslint-config/  # 共享 ESLint Flat Config
│       ├── postcss-config/ # 共享 PostCSS 配置
│       ├── tailwind-config/# 共享 Tailwind v4 主题与变量
│       └── tsconfig/       # 共享 TypeScript 基础配置
│
├── .changeset/             # 版本发布管理
├── turbo.json              # 任务编排配置
└── pnpm-workspace.yaml     # 工作区定义 & Catalog 版本管理

```

## 🚀 快速开始

### 前置要求

- Node.js `>=24.15.0 <25`
- pnpm `10.26.0`

### 安装依赖

```bash
HUSKY=0 pnpm install --frozen-lockfile

```

### 启动开发环境

先构建可发布包：

```bash
pnpm build:packages

```

随后启动 Nexty 参考 Web 应用：

```bash
pnpm dev:web

```

### 构建项目

```bash
pnpm build

```

## 🛠️ 最佳实践指南

### 1. 配置管理 (Configuration)

本仓库遵循 **"Single Source of Truth"** 原则。所有的工程化配置（TS, ESLint, Tailwind）都提取到了 `packages/configs` 中。

- **新增配置**：请在 `packages/configs` 下修改，不要在 App 内部通过复制粘贴解决。
- **引用配置**：App 通过 `package.json` 的 `devDependencies` 引入共享包，例如 `"@biu/tsconfig": "workspace:*"`。

### 2. 样式开发 (Tailwind v4)

我们使用 Tailwind v4 的 CSS-first 模式。在引入共享主题时，**必须严格遵守以下顺序**，否则会导致编译错误：

```css
/* apps/xxx/src/styles.css */

/* ✅ 正确顺序：先配置，后生成 */

/* 1. 引入共享配置 (定义变量) */
@import "@biu/tailwind-config";

/* 2. 引入框架核心 (生成工具类) */
@import "tailwindcss";

/* 3. 配置扫描路径 */
@source "../index.html";
@source "./**/*.{js,jsx,ts,tsx}";
@source "../../packages/ui-lib/**/*.{js,jsx,ts,tsx}";
```

### 3. 业务开发 (App as Shell)

为了最大化代码复用，建议遵循以下开发流：

- **UI 组件**：放入 `packages/ui-lib`。
- **业务逻辑/Hooks/状态**：建议新建 `packages/features` 或 `packages/core` (Coming Soon)。
- **应用 (Apps)**：仅作为“壳”，负责路由配置、Providers 注入和组件组装。

## 📦 常用命令速查

| 命令         | 说明                     |
| ------------ | ------------------------ |
| `pnpm dev`   | 启动所有应用的开发服务器 |
| `pnpm build` | 构建所有应用和包         |
| `pnpm lint`  | 执行 ESLint 代码检查     |

## 🧰 新建 Package（自动接入 ESLint/Prettier/TSConfig）

当你新建一个 workspace package（`packages/*` 或 `packages/configs/*`）时，通常需要手工补齐：

- `@biu/eslint-config`（统一 ESLint v9 Flat Config）
- `@biu/tsconfig`（统一 TS 配置）
- `"prettier": "@biu/prettier-config"`（方案 A）

为了避免重复劳动，本仓库提供了 Plop 生成器。

### 交互式创建（推荐）

```bash
pnpm -w new:pkg
```

你可以在交互里选择：

- 生成到 `packages/` 还是 `packages/configs/`
- 是否生成带 React peerDependencies 的包
- 包名默认会自动补 `@biu/` 前缀（当然也支持你直接输入 `@biu/foo`）

### 非交互式创建（可用于脚本）

```bash
pnpm -w gen package -- --scope niu --name demo-lib --kind lib --dir packages --react false
```

> 注意：生成后需要执行一次安装（`pnpm -w install`），让新包进入 lockfile / turbo scope。

## 🤝 贡献与规范

- **提交规范**: 遵循 Conventional Commits (例如: `feat: add new button component`)。
- **代码风格**: 提交前会自动运行 `eslint --fix`，请确保无报错。

---

Built with ❤️ using [Turborepo](https://turbo.build/repo) & [pnpm](https://pnpm.io/).
