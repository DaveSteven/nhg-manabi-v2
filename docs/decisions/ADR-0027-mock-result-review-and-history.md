# ADR-0027 模考成绩逐题回顾与学习历史整合

日期：2026-11-18。状态：已确认（用户方案 P0/P1，"minao 2.0 · 模考成绩与学习历史整合方案"）。

## 背景
模考成绩页只有各阶段/科目汇总，没有逐题回顾；完成的模考不出现在「我的学习 → 练习历史」，试卷详情也看不到同一份试卷的历次成绩（原约定"模考不进练习历史"）。

## 决策
1. 保留一级导航「学习」；用户中心不放学习历史与成绩；不新增成绩中心。
2. 模考成绩页（`/study/mock/:id/results`）= 成绩概览 → 科目表现 → 逐题回顾 → 底部操作。概览只给**原始正确率**（按已作答口径）、答对/答错/未答、用时、完成时间，并明示"不等同于 JLPT 官方换算成绩"。**不做换算分与合格判定**（沿用 ADR-0019 M7：无可靠换算模型）。
3. 逐题回顾复用专项练习的 `ReviewQuestion`（共享材料按完整 Unit、听力 Dock 与原文、解析）；按文字词汇/文法/读解/听力分组，全部/错误/未答筛选，默认定位第一道错题；历史只读。
4. 解析与听力原文只在**整场模考完成后**由模考专用接口开放：`GET /api/mock-exams/{id}/units/{su}/feedback|transcript`（未完成一律 409 `mock_not_finished`，他人 404）。题目内容沿用公开（无答案）release Unit 接口。`/results` 增加试卷信息、用时与逐题的 session_unit/phase/subject。
5. 「练习历史」纳入**已完成**的模考（放弃的模考仍不可见，ADR-0025）；`GET /api/me/learning/history?kind=all|quick|topic|mock` 提供筛选；记录进入同一成绩页。
6. 试卷详情增加「历次模拟考试记录」：`GET /api/exams/{exam_id}/mock-results`（仅本人已完成，新到旧）；同一试卷允许多次，每次独立保存。所有入口用同一 session ID 取结果，不另存/重算。
7. 模考仍不写 `user_question_progress`（ADR-0019 M7 不变）。
8. P2 不做：趋势图、多次对比、AI 报告、独立 Dashboard。

## 影响
无 Schema 变更。取代 `mock_exam.py` 与文档中"模考不列入练习历史"的说法。听力原文逻辑从 practice 抽出共享（`_build_unit_transcript`），练习端点行为不变。
