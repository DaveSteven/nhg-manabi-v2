# ADR-0028：管理端界面框架由 shadcn-admin 改为 Ant Design

**状态：** Accepted（用户 2026-11-18 决定；取代 ADR-0008 中的界面基础选择）  
**项目：** nhg-manabi-v2  
**日期：** 2026-11-18  
**决策范围：** `apps/admin` 前端界面层

## 1. 背景

ADR-0008 选定 `satnaing/shadcn-admin`（shadcn/ui + Tailwind + Radix）为管理端基础。用户决定改用 Ant Design 体系的管理端框架，参考工程为本机 `~/Code/antd-admin`（仓库外、非 git 仓库、无 LICENSE 文件）。管理端已有登录、运营 Dashboard、试卷管理（下架/恢复）、用户管理（列表/详情/禁用启用）四块功能，需整体迁移。

## 2. 决策

- `apps/admin` 界面层改为 **Ant Design 6**（`antd` + `@ant-design/icons`），中文语言包 `zh_CN`，支持浅色/深色（antd 主题算法）。ADR-0008 中 shadcn/ui、Tailwind、Radix、React Hook Form、TanStack Table、sonner 的约定不再适用。
- **不变**：独立 React + TypeScript + Vite SPA；TanStack Router（文件路由）/Query；Zustand；Zod 严格 DTO；axios API 层；FastAPI 为身份/权限/发布规则唯一事实源（ADR-0009/0010）；管理员令牌仅存 `sessionStorage`；服务端校验的路由守卫。后端与 API 契约零改动。
- 参考 `antd-admin` 的是布局形态（可折叠侧栏、顶栏面包屑、主题切换、用户菜单）与技术组合，**没有拷贝其代码**：该工程自带 Mock 数据（MSW）、模拟权限菜单和自有 `/api/auth/*` 约定，与本项目不符。
- 不采用其 Vite+（`vp`）工具链：保留仓库现有的标准 Vite + Vitest，避免在 monorepo 引入 beta 级工具链与 vite/vitest 覆盖。
- 图表仍用 recharts（antd 无内置图表）。
- 视觉保持管理端独立，不套用学生端「樱与墨」。

## 3. 影响

- 删除 shadcn/Radix/Tailwind 相关依赖与 `components/ui`；新增 antd 依赖（构建后 antd 单独分包约 1.1MB / 368KB gzip，仅管理端加载）。
- 原 `vitest browser` 套件（需 Playwright Chromium）已随上游测试一起移除，单元测试沿用 happy-dom。
- 管理端路由、URL、API 调用保持不变，`deploy/` 与 Docker 构建命令不变。
- 页面与口径规范见 `docs/development/admin-dashboard.md`、`admin-users.md`；未来新增页面使用 antd 组件。
