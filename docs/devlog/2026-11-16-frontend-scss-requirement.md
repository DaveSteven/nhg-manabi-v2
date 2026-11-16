# 前端 SCSS 样式规范补充

日期：2026-11-16

## 任务范围

将“前端样式使用 SCSS 编写”加入学生端正式工程规范。本次只确认并记录样式技术约束，不重构当前工作区中尚未提交的练习页实现。

## 改动

- `docs/design/frontend-spec.md`：将 SCSS 加入前端工程方向，明确组件局部样式优先 `.module.scss`，全局 token/reset/基础样式使用职责明确的 `.scss` 入口。
- `docs/development/coding-standards.md`：新增 React/TypeScript 样式编码要求，限制继续新增普通 CSS 业务样式和无边界全局覆盖。
- `docs/development/M2.2-frontend-implementation.md`：同步 M2.2 技术约束及建议目录说明。
- `docs/devlog/progress.md`：记录规范已确认及现有 CSS 尚待迁移的真实状态。

## 结论与后续

- 后续新增或修改前端业务样式统一使用 SCSS。
- 当前 `apps/web` 尚未安装 `sass`，现有 `global.css` 及其他 CSS 不在本次纯文档任务中迁移；应在下一次实际样式实现任务中安装依赖、迁移受影响文件并执行前端完整验证。
- 本次没有改变渲染架构、产品需求或数据模型，因此不新增 ADR。

## 测试与检查

- 已检查文档差异与 Git 工作区，确认本次只新增/修改上述文档。
- 未运行前端 typecheck、单元测试或构建：本次没有代码、依赖或构建配置变更。
- 未运行后端测试：本次不涉及后端。
