# 开发日志 · 2026-11-16 · ADR-0007 混合渲染架构决策

## 范围

仅文档：将 M2 计划 Task 09 前置的「混合渲染」架构决策落为正式 ADR。无代码改动，无测试执行（无涉及代码路径）。

## 改动内容

- 新增 `docs/decisions/ADR-0007-hybrid-rendering-strategy.md`：React Router Framework Mode + SSG（品牌/内容页）+ SPA（学习系统），第一阶段禁用运行时 SSR，不引入 Next.js / Node SSR 服务。
- **编号修正**：用户原建议编号 ADR-0005 已被「审核事件确定性顺序与可追踪 Issue」占用，ADR-0006 已被「M2 最小用户身份边界」占用（同日落地），故顺延为 ADR-0007；`docs/development/M2-core-learning-flow.md` Task 09 中的编号引用同步修正。
- `docs/decisions/README.md` 新增 P-017 索引行，ADR 导航补齐 0006/0007。
- progress.md 已完成清单补充本条。

## 与并行会话产出的合并

本任务执行期间发现另一会话已就同一决策产出 `ADR-0007-frontend-rendering-strategy.md` 及 `docs/design/frontend-spec.md`「页面渲染策略」章节（见 `2026-11-16-frontend-rendering-strategy.md`）。处理：

- 两份 ADR 合并为单一 `ADR-0007-hybrid-rendering-strategy.md`：正文以用户确认的全文为准，并入并行版本的补充约束（SPA fallback 必须真实 404、SEO noindex/hreflang 边界、构建期不得注入私有数据、SSR 复审触发条件、frontend-spec 关联）。
- 删除重复的 `ADR-0007-frontend-rendering-strategy.md`，其 devlog 与 README 导航中的文件名引用已修正。
- frontend-spec.md 的「页面渲染策略」章节（并行会话产出）保留并纳入本批提交。

## 测试

未执行（纯文档变更；无代码、无迁移、无接口改动）。

## 影响

M2.2 Task 09 前端工程可据此直接搭建：品牌页静态预渲染、`/study` SPA、FastAPI 继续供业务 API、Nginx 区分预渲染与 SPA fallback。其余里程碑不受影响。

## 剩余风险

- 具体路由路径与 `page-structure.md` 的统一推迟到 M2.2 Task 09 实现时完成（沿用并行会话 devlog 的记录）。
- React Router Framework Mode 的 prerender/SPA fallback 实际行为以届时构建产物验证为准。
