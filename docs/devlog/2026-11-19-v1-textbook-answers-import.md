# 2026-11-19 · V1 教材作答迁移脚本

## 范围
ADR-0030：把 V1 教材练习（`attempts`/`attempt_answers`）迁成 v2 的正式答案。本次只交付脚本与合成数据测试；**未对线上 V1 做 dry-run**（见未执行）。

## 为什么不是只写进度表
`user_question_progress` 是缓存，`question_progress.py` 每次提交都从 `study_submitted_answers` 重算；只导缓存会被下一次练习覆盖。所以导入为已完成会话 + 正式答案，再重建进度。

## 改动
- `app/v1_answer_import.py`：按 V1 attempt 建 completed practice 会话（`config.supplementary.imported_from="v1"`、`v1_attempt_id` 幂等）、session unit、正式答案、结果；对错按 v2 答案 Key 的选项位置重判；跳过并分类计数：`no_v2_question`、`manually_repaired_question`、`unit_not_practicable`、`answer_key_differs`、`chosen_option_missing`；用户未导入则跳过整个 attempt；最后 `rebuild_user_progress`。默认 dry-run 回滚。
- 学生端 DTO：`config.supplementary` 增加可选 `imported_from`/`v1_attempt_id`。
- ADR-0030 增补迁移一节。

## 测试
- 后端 `pytest -q`（真实本地 PG 测试库）：323 passed, 2 skipped（新增 `test_v1_answer_import.py` 3 项：dry-run 不写入、apply 后会话/答案/结果/进度正确且 skip 保持 NULL、V1 判对但 v2 判错时按 v2 重判；幂等与重建进度后不变；课程进度可见而「我的学习」不含）。
- 学生端 `vitest run` 360 passed、`tsc --noEmit` 通过。

## 未执行 / 风险
- 未对线上 V1 的 448 条教材作答做 dry-run（需要再次连接线上 V1 库，待用户授权）；真实跳过比例、被 v2 改判的数量未知。
- 前置条件未满足：开发库/生产尚未导入 V1 用户和 362 课扩展内容，脚本现在只能在测试库用合成数据验证。
- 导入的作答会计入管理端「学习活跃/作答」统计与会话数（历史时间点按 V1 原时间）。
