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

## 补充：线上 V1 只读 dry-run（用户授权，2026-11-19）
- 方式：`ssh manabi` 建只读隧道读取 V1 线上库；写入端只用本地**测试库**——先转换并导入 362 课扩展内容、导入 7 个 V1 用户，再对教材作答 dry-run（事务回滚）。结束后测试库中的课程、用户、会话已全部清理，隧道与临时文件已删除；V1 线上库与 v2 开发库均未改动。
- V1 当前数据：教材练习 69 个 attempt、538 条作答（比之前统计时多，V1 仍在使用）；用户导入 dry-run 同前（7 人，全部无邮箱）。
- 结果：**69 个会话、538 条作答全部可导入（涉及 5 位用户）；跳过 0 条，被 v2 答案 Key 改判 0 条**（V1 当时的对错与 v2 的答案完全一致）。dry-run 回滚后会话与进度均为 0。
- 注意：V1 仍在产生新作答，正式迁移前应冻结 V1（或在切换当天再跑一次；脚本按 attempt 幂等，可补入新增）。
- 仍未做：对开发库/生产的正式导入（前置：生产部署 0019/0020、导入 7 个用户与 362 课、再导入作答）。
