# 2026-11-18 · 严格模拟考试：后端（ADR-0019 第 1 步）

## 范围
只做后端：单名额迁移、模考状态机与接口、答案泄漏边界、测试。不含前端、严格听力播放器、真实内容的浏览器验收。无新 ADR（实现 ADR-0019，已在其末尾追加实现备注）。

## 改动
- **迁移 0013**：`ux_one_active_main`（practice+mock 共用）取代 `ux_one_active_practice`/`ux_one_active_mock`；`study_phase_runs` 加 `uq_phase_run_once`、`ck_phase_run_window`、`ux_one_open_phase_run`。`schema.py` 不改（0001 一致性测试冻结在初始 DDL，后续迁移均如此）。
- **`app/api/mock_exam.py`**（新）：
  - `GET /api/exams/{id}/mock` 公开可用性（无 Phase/缺时限/空 Phase/有未 complete 或无归属 Unit → 不可用并给出 reason）。
  - `POST /api/mock-exams` 固定当前 release、按 Phase 顺序建 session units、开始第 1 个 Phase；同事务放弃进行中的练习或模考。
  - 状态机：任何访问会话的请求先 `_advance`（会话行 `FOR UPDATE`），到期 Phase 按草稿正式提交（无选择 = skip）、下一 Phase 自上一到期时刻起算，最后一个 Phase 关闭即完成并写 `study_results`（`scoring_method=mock_phases`）。长时间离开会链式封存全部 Phase。
  - 内容/草稿/交 Phase 接口；Phase 写在提交路径上，重试对已关闭 Phase 幂等；已放弃的模考拒绝写入；结果仅在完成后开放（各 Phase/科目答对数与正确率 + 逐题回顾）。
- **`practice.py` 小重构（行为不变）**：草稿写入抽出 `_save_draft` 共用；`_judge_and_store_unit` 增 `refresh_progress`（模考不写练习进度缓存）；`_complete_session` 增 `scoring_method`；创建练习时同时放弃进行中的模考。

## 测试（实际执行）
- 后端全量 `pytest`（真实 PG 测试库）：**252 passed、2 skipped**（新增 `test_mock_exam.py` 9 项：可用性与不可用原因、鉴权、完整流程（Phase 顺序、未来 Phase 内容 409、已关闭 Phase 不可回看/编辑、重复提交无副作用、交卷前无结果、各接口无 `correct_option_id/answer_key/explanations/cues/is_correct`、结果分 Phase/科目、不写 `user_question_progress`）、校验与跨用户隔离、到期按草稿封存且下一 Phase 时钟继续、离开两小时全部封存为 skip、练习↔模考↔模考互相替换且 Quick 不受影响、DB 约束、并发 4 路提交仅关闭一次）。`test_single_session` 的索引断言改为新索引名。
- 迁移：测试库 `downgrade 0012` → `upgrade head` 通过（up/down/up）。**开发库（Docker）尚未迁移**，下次 `docker compose up` 的 migrate 服务会执行。

## 未执行 / 风险
- 前端、严格听力播放器、浏览器端到端均未做；真实 105 套试卷上未实跑（开发库未迁移；74 个隐藏 Unit 所在试卷会因 `units_not_ready` 不开放模考）。
- 音频资产可用性（media_storage）尚未作为开放条件；结果里尚无解析与听力原文。
- 惰性封存依赖有请求到来；放弃的进行中模考保留一个未关闭 run（不影响约束，仅状态为 abandoned）。
- 误触「开始练习」会静默放弃计时中的模考（ADR-0019 M8 用户已决定不加确认）。未推送、未部署。
