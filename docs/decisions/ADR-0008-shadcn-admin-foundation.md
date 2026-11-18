# ADR-0008：管理端采用 shadcn-admin 作为界面基础

**状态：** Superseded（界面框架部分已被 ADR-0028 取代；身份/权限/后端事实源约定仍有效）  
**项目：** nhg-manabi-v2  
**日期：** 2026-11-16  
**决策范围：** `apps/admin` 管理端前端

## 1. 背景

JLPT GO 2.0 管理端需要承载导入批次、数据质量问题、Unit/Question 审核、原始/规范化内容对照、发布决策和版本追溯。现有 `apps/admin` 只有占位 README，规范仅确定它是独立 React SPA，尚未选择工程基础和视觉方案。

用户确认采用开源项目 [`satnaing/shadcn-admin`](https://github.com/satnaing/shadcn-admin) 作为管理端基础，并保留上游原有视觉主题；管理端不套用学生端「樱与墨」配色。

## 2. 决策

- `apps/admin` 以 `shadcn-admin` 的经审查、固定版本源码为起点，作为独立 React + TypeScript + Vite SPA。
- 保留上游默认视觉语言、布局和主题能力，不要求与 `apps/web` 共用「樱与墨」tokens。
- 可沿用其 shadcn/ui、Tailwind CSS、Radix primitives、TanStack Router/Query/Table、Zustand、React Hook Form 与 Zod 等前端组合；具体版本在实际引入时锁定并记录。
- 管理端继续使用 JLPT GO FastAPI 作为业务、身份、审核和发布权限的唯一后端事实源。
- 不采用上游示例身份体系作为生产认证。引入时移除 Clerk、示例账号、Mock 业务数据和与本项目无关的页面。
- 不自动跟随上游 `main`。首次引入必须记录来源仓库、commit/tag、MIT 许可证和本地改动；后续升级按独立任务审查和合并。
- 上游模板不覆盖本项目 `AGENTS.md`、ADR、审核/发布规范或 API 权限边界。

## 3. 主要理由

- 默认界面比传统企业后台更轻盈、现代，符合用户对管理端视觉的选择。
- 已具备响应式壳层、表格、表单、对话框、命令菜单和常见管理页面结构，可减少非业务基础 UI 工作。
- 源码型 shadcn/ui 组件便于按审核工作流局部改造，不需要把学生端设计系统强行共享给内部工具。
- Vite SPA 与现有独立管理端部署方向一致，不增加 Node.js SSR 服务。

## 4. 备选方案

| 方案 | 不采用的原因 |
|---|---|
| `zuiidea/antd-admin` | 后台能力完整，但用户最终选择 shadcn-admin 的视觉方向 |
| Ant Design Pro | Umi/Pro 体系较重，默认视觉更偏传统企业后台 |
| Refine | CRUD 能力强，但会额外引入框架抽象；当前审核/发布流程并非纯标准 CRUD |
| 从零搭建 | 自由度最高，但会重复实现管理端壳层和通用交互 |

## 5. 影响与约束

- `apps/admin` 与 `apps/web` 允许不同 Router、组件库和视觉 tokens，但共享 FastAPI 契约、身份与权限模型。
- 管理端必须独立构建、部署和 `noindex`；不参与学生端 SSG、SEO 或路由 fallback。
- 模板中的客户端路由保护只能改善体验，不能替代 FastAPI 对每个管理接口的认证与授权。
- Draft、答案、审核证据和发布操作仅对授权管理身份开放；学生公开接口边界不因管理端存在而放宽。
- 引入第三方代码时保留 MIT 许可证和版权声明，执行依赖、脚本、凭据、遥测与供应链检查。
- 上游 UI 不是产品需求事实源。页面范围仍以本项目审核、数据质量和发布规范为准。

## 6. 验收条件

- `apps/admin` 可独立安装、构建和直接访问 SPA 路由。
- 上游来源 commit/tag、许可证和本地改造记录可追溯。
- Clerk、示例凭据、演示业务数据和无关页面已移除或隔离在开发 Mock 中。
- FastAPI 管理认证与权限失败时默认拒绝；前端不保存发布令牌或私有答案到公开构建产物。
- 导入批次、Issue/审核、内容对照、发布决策和版本回顾至少形成一条可测试纵向流程。
- 键盘、焦点、表格密度、长日文内容和浅/深色默认主题经过实际页面验收。

## 7. 非决策内容

本 ADR 不授权立即克隆、安装、推送、部署或发布管理端，也不决定正式管理员认证方案。实际引入按 `docs/development/admin-frontend-implementation.md` 单独实施。
