# 2026-11-18 模考成绩逐题回顾与学习历史整合（ADR-0027）

## 范围
用户方案 P0（模考成绩与回顾）+ P1（练习历史模考记录、试卷详情历次模考）。P2（趋势、对比、AI 报告、Dashboard）未做。无 Schema 变更。

## 改动
后端
- `practice.py`：抽出 `_build_unit_transcript`，practice 端点行为不变。
- `mock_exam.py`：`/results` 增加 exam/level/started_at/duration_seconds 及逐题 `session_unit_id/phase_id/subject/question_type_label`；新增完成后才开放的 `/units/{su}/feedback`、`/transcript`（未完成 409，他人/外来 Unit 404）；新增 `GET /api/exams/{id}/mock-results`。
- `learning.py`：`/history` 增加 `kind` 筛选并纳入已完成模考（放弃/进行中不入）。

前端
- 新增 `features/review/ReviewQuestion.tsx`（由 TopicReview 抽出，专项与模考共用）；AudioDock 的 `transcript.source` 区分练习/模考原文接口。
- `MockResults.tsx` 重写：概览（原始正确率、用时、口径与"非官方换算"说明、无合格判定）→ 科目表现 → 逐题回顾（科目分组题号、全部/错误/未答筛选、默认首个错题、上一题/下一题）→ 返回试卷/练习历史。
- 练习历史加四项筛选与"模拟考试"来源，模考行进入 `/study/mock/:id/results`；试卷详情新增 `MockRecords`。

文档：ADR-0027、决策表 P-029、api-conventions、mock-exam-ui、docs/README。

## 测试（实际运行）
- 后端（真实本地 PG，`source .env`）：`pytest tests` → 274 passed, 2 skipped（新增 5 项：结果扩展字段、完成前 409/完成后开放/越权 404、放弃无回顾、试卷模考列表独立/不覆盖/隔离、历史纳入模考+kind 过滤+越界页 total）。
- 前端：`tsc --noEmit` 通过；`vitest run` → 341 passed（新增模考成绩页 3 + 试卷记录 2 + 历史筛选 1；修正 1 个因"专项练习"筛选文案重复而失效的断言）；`pnpm build` 通过。
- 未执行：管理端测试（未改动）、真实浏览器/视觉验收、真实库手工走查（含真实听力模考的原文回顾）、Docker 容器重建。

## 决定与风险
- 复盘内容复用公开 release Unit 接口（无答案），答案/解析/原文走模考专用完成后接口，服务端为权限边界。
- 用时 = 各已关闭 Phase 的 (关闭−开始) 秒数之和（每段封顶为该段时限）；听力阶段从确认播放起算。
- 历史页"快速练习"筛选含无专项配置的普通 practice 会话。
- 逐题回顾每个 Unit 单独请求（按需加载）；全程未做预取，慢网下切题会短暂显示"加载中"。
- 未知：换算分/合格判定仍无可靠模型，故不展示。
