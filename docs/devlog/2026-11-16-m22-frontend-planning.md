# 开发日志 · 2026-11-16 · M2.2 前端实施准备

## 范围

只读核实 M2.1 Task 05–08 的实际完成情况与当前 API 契约，并新增 `docs/development/M2.2-frontend-implementation.md`。本次不实现前后端代码、不执行发布、不修改 JLPT GO 1.0。

## 核实结论

- M2.1 Task 01–04 的提交、开发日志与测试文件相符：已有已发布内容目录、固定 Release Unit 查询、最小身份边界、普通练习创建/恢复/提前结束。
- 已提交的 `HEAD` 中 M2.1 Task 05–08 未完成。检查期间 `backend/app/api/practice.py` 出现并行开发的未提交候选实现，随后扩展出草稿、Unit 提交、反馈和结果端点；但尚无对应新增测试，现有会话测试仍只覆盖 Task 04，故不能标记为完成或稳定契约。
- 为避免覆盖并行工作，本次不修改或纳入 `backend/app/api/practice.py`、`backend/tests/conftest.py`、`backend/tests/test_practice_sessions.py`。
- 当前公开 Unit API 不返回 `cues`；前端不能调用 internal Draft Preview 绕过。听力字幕公开时机需在后端契约中明确。
- `apps/web` 目前仍只有 README，没有 React 工程。

## 文档改动

- 新建 M2.2 实施计划，明确 React Router Framework Mode `ssr:false`、公开页面 SSG、学习系统 SPA。
- 统一 M2.2 学习路由到 `/study` 命名空间，避免品牌首页 `/` 与学习首页混淆。
- 定义学习首页、试卷目录、Canonical Unit/RichText/听力 renderer、草稿状态机、提交反馈、自动恢复、无障碍和测试验收。
- 把 Task 05–08 的真实 API 契约与集成测试列为答题闭环接入门槛；明确不能用前端隐藏实现答案权限。
- 继续遵守发布审核、Release 固定、服务端身份和旧版隔离约束。

## 实际检查与结果

- `git status --short --branch`：确认 `main` 比 `origin/main` 领先 3 个提交，并发现外部未提交的 `backend/app/api/practice.py`。
- `git log --oneline --decorate -8`：确认 M2 Task 01–04 与 ADR-0007 已提交。
- `rg`/只读文件检查：确认已提交路由、并行候选端点、Schema、测试、`apps/web` 状态与上述结论。
- `git diff --check`：在提交前执行，结果记录于本次提交。

## 未执行

- 未把现有 Task 04 测试通过解释为 Task 05–08 验收；候选实现尚缺对应新增测试。
- 未运行前端构建、类型检查或组件测试：React 工程尚未创建。
- 未执行 PostgreSQL 数据写入、迁移、内容发布或真实 Agent 校验。

## 决策

本次没有改变既有架构或产品规则，不新增 ADR。M2.2 继续遵循 ADR-0007 和“樱与墨”设计规范。
