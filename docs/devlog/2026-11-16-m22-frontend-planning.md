# 开发日志 · 2026-11-16 · M2.2 前端实施准备

## 范围

只读核实 M2.1 Task 05–08 的实际完成情况与当前 API 契约，并新增 `docs/development/M2.2-frontend-implementation.md`。本次不实现前后端代码、不执行发布、不修改 JLPT GO 1.0。

## 核实结论

- M2.1 Task 01–04 的提交、开发日志与测试文件相符：已有已发布内容目录、固定 Release Unit 查询、最小身份边界、普通练习创建/恢复/提前结束。
- 核查初期 M2.1 Task 05–08 尚在并行开发；最终已由提交 `54d4a1e` 完成草稿、Unit 提交、反馈和结果端点，并新增 `test_study_flow.py` 13 个集成测试，全量记录为 87 passed。
- 本计划未修改并行 agent 的后端实现；最终依据已提交端点、测试与 `2026-11-16-m2-task05-08-answer-flow.md` 校准前端契约。
- 当前公开 Unit API 不返回 `cues`；前端不能调用 internal Draft Preview 绕过。听力字幕公开时机需在后端契约中明确。
- `apps/web` 目前仍只有 README，没有 React 工程。

## 文档改动

- 新建 M2.2 实施计划，明确 React Router Framework Mode `ssr:false`、公开页面 SSG、学习系统 SPA。
- 统一 M2.2 学习路由到 `/study` 命名空间，避免品牌首页 `/` 与学习首页混淆。
- 定义学习首页、试卷目录、Canonical Unit/RichText/听力 renderer、草稿状态机、提交反馈、自动恢复、无障碍和测试验收。
- 记录 Task 05–08 的真实 API 契约与集成测试基线；明确不能用前端隐藏实现答案权限。
- 继续遵守发布审核、Release 固定、服务端身份和旧版隔离约束。

## 实际检查与结果

- `git status --short --branch`、`git log`：最终确认 `54d4a1e` 已提交，M2.1 Task 01–08 均在历史中。
- `rg`/只读文件检查：确认已提交路由、Schema、`test_study_flow.py`、后端开发日志和 `apps/web` 状态与上述结论。
- `git diff --check`：在提交前执行，结果记录于本次提交。

## 未执行

- 未运行前端构建、类型检查或组件测试：React 工程尚未创建。
- 未执行 PostgreSQL 数据写入、迁移、内容发布或真实 Agent 校验。

## 最终复核

- 在 `54d4a1e` 提交后独立重跑 `backend/.venv/bin/python -m pytest`：**87 passed，2 warnings，7.96s**。Warnings 为 Starlette TestClient/httpx 弃用提示和 Alembic `path_separator` 配置提示，不影响本次结果。
- `git diff --check`：通过。

## 决策

本次没有改变既有架构或产品规则，不新增 ADR。M2.2 继续遵循 ADR-0007 和“樱与墨”设计规范。
