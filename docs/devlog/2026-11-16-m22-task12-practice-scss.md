# M2.2 Commit 4 · 作答闭环与 SCSS 迁移

日期：2026-11-16

## 范围

- 完成 `PracticePage.test.tsx` 覆盖的恢复、草稿、提交、反馈和结果闭环。
- 安装 Sass，并将学生端现有全局 CSS 迁移、拆分为 SCSS。
- 不改后端 Schema、发布规则或 JLPT GO 1.0。

## 实现

- 新增练习页面及草稿状态机、自动保存、待重试记录、提交确认、反馈门控、Session 恢复和结果模型。
- 正式提交仍按完整 Unit；未答保持 skipped，提交后锁定；统一反馈在 Session 结束前不请求答案。
- 修复 `useDraftManager` 的回调依赖：恢复完成后必须使用当前 `sessionUnitId`，避免请求落到 `/units//drafts`。
- 修正路由集成测试：feature 组件显式传入 `sessionId`，目录测试通过真实 route wrapper 读取 URL 参数，并补齐导航后的恢复 API fixtures。
- 为 Node 26/happy-dom 测试环境提供确定性的内存 localStorage，避免实验性 Node storage 干扰草稿重试测试。
- 安装 `sass`；将 `tokens.css`、`global.css` 迁移为 `.scss`，把练习、对话框、反馈和结果样式拆到 `_practice.scss`，由全局入口 `@use`。

## 验收结果

- `pnpm --filter web exec vitest run app/features/practice/PracticePage.test.tsx`：6 passed。
- `pnpm --filter web test`：15 files、97 tests 全部通过。
- `pnpm --filter web typecheck`：通过。
- `pnpm --filter web build`：通过；Dart Sass 编译成功，品牌页 prerender、SPA fallback/noindex 与凭据泄漏检查通过。
- `pnpm --filter web exec sass --version`：1.108.2。

## 已知事项

- `pnpm add` 报告 `@parcel/watcher` 可选构建脚本被 pnpm 安全策略忽略；Dart Sass CLI、Vite production build 均可正常工作，不需要为当前构建批准原生 watcher 脚本。
- 全量 Vitest 退出码为 0，但 happy-dom 在部分路由测试卸载尚未完成的 fetch 时仍输出 `ECONNREFUSED/AbortError` stderr；本次没有把该噪声误报为测试失败，后续可集中清理异步 teardown。
- 未执行真实 PostgreSQL 后端测试或真实浏览器 E2E；本次改动集中于前端，下一阶段按 M2.3 使用隔离测试库验证。

## 决策

本次实现遵循既有 ADR-0007 与前端 SCSS 规范，没有改变产品或架构决策，不新增 ADR。
