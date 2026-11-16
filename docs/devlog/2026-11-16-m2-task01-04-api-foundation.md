# 开发日志 · 2026-11-16 · M2 Task 01–04（作答引擎地基）

## 范围

按 `docs/development/M2-core-learning-flow.md` 执行 M2.1 的 Task 01–04：开发前检查、题库查询 API、最小用户身份边界、练习会话管理。**不含** Task 05–08（草稿、正式提交、反馈权限、结果统计），不含前端。

## Task 01 · 开发前检查结论

- 工作区干净（仅本次计划文件未跟踪）；Alembic 至 `0003`；SQLAlchemy 32 表与迁移一致性测试通过。
- `study_sessions`（含单活跃练习 partial unique index `ux_one_active_practice`）、`study_session_units`（含 `release_id` 快照 FK）、`study_answer_drafts`（`row_version`）、`study_submitted_answers`（skip 语义 CHECK）、`study_results` 均已在 Schema v0.2 建好，Task 04 无需迁移。
- 既有 API 复用情况：`/api/exams`、`/api/exams/{id}/units/{unit_id}`（公开）、`/internal/...`（令牌保护 Draft Preview）已存在，本次只做扩展不重写。
- 关键缺口：schema 无 users 表、`user_id` 为无 FK UUID → 由 ADR-0006 定义最小身份边界。
- 发布行为确认：promote 后旧 release 保持 `published` 状态，历史 Session 引用旧 release 可继续读取（Task 04 的 release 绑定依赖此事实）。

## 改动内容

**Task 02 · 题库查询 API**（`app/api/content.py`）

- `GET /api/exams/{exam_id}`：试卷轮廓（Section → Layer → Unit 目录 + 每单元 `question_count`），仅当前发布 release、仅 `conversion_status='complete'` 单元。
- `GET /api/exams/{exam_id}/layers`：大题目录（仅 `unit_count`，不展开单元）。
- `GET /api/releases/{release_id}/units/{unit_id}`：按具体 release 取 Unit——供进行中会话恢复内容；仅 `state='published'` 的 release 可读，draft 一律 404（Draft Preview 仍走 `/internal` 令牌边界）。
- 公开载荷泄漏检查复用既有标准：无 `answer_key` / `correct_option_id` / `review_status` / `explanations` / `provenance` / `availability`。

**Task 03 · 最小用户身份边界**（`app/auth.py`，ADR-0006）

- `get_current_user_id` 依赖：服务端解析身份，不接受客户端传入 `user_id`；未配置认证时 fail-closed 401。
- `AUTH_MODE=dev_test`：Bearer token = 用户 UUID，须列于 `DEV_TEST_USER_IDS`；`APP_ENV=production` 下硬禁用。

**Task 04 · 练习会话管理**（`app/api/practice.py`）

- `POST /api/practice/sessions`：创建普通练习（mode=practice），请求体指定 `feedback_mode` + 有序 Unit 列表（单/多 Unit）；每个 (release_id, unit_id) 校验为**当前发布 release 且转换 complete**，否则 422 `unit_not_available`；Session Unit 按请求顺序固定 position 并绑定具体 release_id。
- 单活跃练习：预检查返回 409 + `active_session_id`（前端据此提示「继续或结束旧练习」）；并发竞态由 `ux_one_active_practice` 兜底，同样 409。
- `GET /api/practice/sessions/current`、`GET /api/practice/sessions/{id}`：恢复会话；跨账号访问与不存在返回相同 404。
- `POST /api/practice/sessions/{id}/finish`：主动结束 → `ended_early`（保留已正式提交内容，不生成任何 study_results 虚假成绩）；对已 `ended_early` 的会话幂等；结束后释放单活跃名额。
- 「完成练习后保存结果」（计分完成路径）按计划属 Task 08，本次未实现——`finish` 仅产生 `ended_early`。

## 测试结果（真实执行）

命令：`backend/.venv/bin/python -m pytest`（`DATABASE_URL` 指向 Docker PG 55432，conftest 自动落到隔离的 `nhg_manabi_v2_test` 库；开发库 staging 数据未动）。

- 新增 19 个测试全部通过：
  - `test_auth.py` 6：fail-closed、dev_test 解析/拒绝、production 硬禁用、端点级 401。
  - `test_content_queries.py` 5：试卷轮廓结构与零泄漏、layers 目录、release 定位 Unit（含选项顺序）、draft 不可公开读、404 语义。
  - `test_practice_sessions.py` 8：创建固定 release 绑定与顺序、单 Unit、单活跃 409 冲突（含跨用户不互斥）、恢复、跨账号隔离、finish 幂等且不生成成绩并释放名额、draft/未知 Unit 422、空/重复/非法 feedback_mode 422。
- 全量回归：**74 passed**（M1.6 末为 55，新增 19，零回归）。
- 测试基础设施：`conftest.clean_publish` 现在先清理 study 域行再清 fixture release（`fk_session_unit_snapshot` 会阻断 release 删除）；新增 `published_release` fixture 走完真实发布门槛（human_reviewed + media verified + rights_confirmed → promote）。

## 未执行 / 待办

- 未配置 ruff/mypy（已知缺口，本次未补）；本次未跑前端或导入器相关检查（无涉及改动）。
- 未答提交、判题、草稿、反馈权限、结果统计 = Task 05–08。
- 开放问题（记录，不擅自决定）：听力 Unit 的 `cues`（含字幕文本）目前只在 internal/授权载荷返回；M2 前端答题页若需作答前显示字幕，属于产品决策，留待 Task 07/11 与用户确认。

## 文档与提交

- ADR-0006（最小用户身份边界）新增，`docs/decisions/README.md` 增加 P-016。
- progress.md 更新：M2 标为当前开发阶段，Task 01–04 移入已完成。
- 本日志与代码同批提交（`feat(api)`，对应计划提交 1）。
