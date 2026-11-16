# 开发日志 · 2026-11-16 · shadcn-admin 管理端计划

## 范围

记录用户确认的管理端技术选择并形成独立实施计划。本次只修改文档，不克隆上游、不生成 `apps/admin` 工程、不安装依赖。

## 决策与改动

- 新增 ADR-0008：`apps/admin` 采用 `satnaing/shadcn-admin` 作为工程/UI 基础。
- 管理端保留上游默认视觉主题和配色，不套用学生端「樱与墨」。
- 新增 `docs/development/admin-frontend-implementation.md`，覆盖安全引入、固定上游版本、许可证、身份/权限、页面阶段、测试和首任务验收。
- 更新决策索引、文档导航、前端规范、`apps/admin/README.md` 和 progress。
- 明确上游 Clerk、示例账号、Mock 业务数据和演示页面不得直接成为生产实现；FastAPI 审核/发布权限仍为事实源。

## 验证

- 检查新增/修改文档的相互引用和文件路径。
- 执行 `git diff --check`。
- 未运行 pytest、前端测试或构建：本次无产品代码和依赖变更，管理端工程尚未生成。

## ADR

新增 `ADR-0008-shadcn-admin-foundation.md`。这是持久的管理端技术与视觉选择，故不只记录在计划中。

## 未执行

- 未克隆、下载或复制 `shadcn-admin`。
- 未审计具体上游 commit/tag、依赖锁文件或安装脚本；实际引入任务必须先完成。
- 未推送、部署或合并 `main`；本次提交留在 `develop`。
