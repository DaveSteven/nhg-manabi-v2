# 2026-11-17 · 专项练习统一反馈：整次一次性提交

## 问题
统一反馈（`end`）专项练习仍逐 Unit「提交本组 → 下一组」，与产品定义不符：统一反馈应在整次练习提交前随时可改答案，最终一次性判题并出结果。

## 改动
- 后端（无 Schema 变更）：
  - 新增 `POST /api/practice/sessions/{id}/submit`：仅 `practice` 模式 + `end` 反馈；会话行锁内一次事务判定所有 pending Unit、写正式答案、标记 submitted、`_complete_session` 写 `study_results`；任一答案非法（invalid_option / question_not_in_unit / session_unit_not_in_session / answer_key_missing）整体回滚；已完成会话重复调用返回已存结果（`idempotent=true`，不重判不重写）；ended_early 等返回 409 `session_not_active`；即时反馈会话 409 `final_submit_end_mode_only`。请求体为最终答案全集（草稿仅供刷新恢复），缺省题目按未答。
  - 抽出 `_judge_and_store_unit`（逐 Unit 提交与整次提交共用同一判题/写入逻辑）。
  - 逐 Unit 提交接口对 `practice`+`end` 会话返回 409 `end_mode_requires_final_submit`：导航与草稿绝不写正式答案；即时反馈与 Quick Practice 不变。
  - 草稿接口、反馈/听力原文门控、finish 接口未改（门控仍是「会话结束后才开放」）。
- 前端：新增 `UnifiedPractice.tsx`，`PracticePage` 对 `practice`+`end` 会话分流（即时反馈/Quick 仍走原逐 Unit 页面）。整次练习为连续题目流：「第 k / N 题」、上一题/下一题、可折行的题号导航（已选高亮）、多题共享材料 Unit 每题都带完整材料；选择只保存草稿（`useDraftManager` 新增 `unitOf`，一个管理器可保存任意 Unit 的草稿，刷新恢复所有 Unit 草稿）；最后一题「完成并提交练习」，有未答题仅在此确认一次（`UnansweredConfirmDialog` 加 `scope`），网络超时先查会话是否已完成再提示重试；完成后同页为只读复盘（答案、解析，经后端门控），结果页新增「查看答案与解析」。`FeedbackView` 抽到独立文件。
- 文档：frontend-spec（专项练习流程，统一/即时两种）、practice-interactions、M2-core-learning-flow（Task 07 提交方式）。

## 测试（实际执行）
- 后端 `pytest`（真实 PG 测试库）：203 passed、2 skipped。新增 `test_unified_submit.py` 6 项：草稿与导航绝不写正式答案/结果且反馈、听力原文封闭、刷新恢复顺序与草稿；逐 Unit 提交 409 与即时反馈不受影响；整次提交一次判所有 Unit，答对/答错/未答分别统计（1/1/1，共 3）；幂等（重试带不同答案也不重判不重写，results 仅一行）；非法答案整体回滚、会话仍可编辑、修正后可提交；仅所有者可提交、其它会话互不影响、已结束会话 409。改写 `test_study_flow`、`test_transcript_gate`、`test_multi_session` 中的统一反馈用例。
- 前端 `vitest`：28 文件 / 244 passed（新增 `UnifiedPractice.test.tsx` 6 项：只有上一题/下一题且无「提交本组」、不提交不请求解析；同 Unit 材料保持；草稿按各自 Unit 路径保存、可返回修改、题号跳转；最后一题确认一次后单次提交且请求体含 null 未答；全答直接提交；刷新恢复各 Unit 草稿、提交失败保留答案；完成后只读复盘）；`tsc --noEmit` 通过。

## 未执行 / 风险
- 未做真实浏览器验收（题号导航样式、长列表折行、听力 AudioDock 在统一反馈流中的表现）。
- 题号导航在题量很大（100 Unit）时占高，未做折叠；统一反馈不提供「提交前预览未答清单」，仅数量确认。
- 未推送、未部署、未合并 main。
