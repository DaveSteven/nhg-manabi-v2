# 2026-11-17 · 取消专项/普通练习单活跃限制（ADR-0015）

## 范围
用户决定：Session 用于保存学习数据，不用于限制自由选择练习。取消「已有进行中的练习」冲突提示及后端限制。Quick Practice 与严格模考不变。新增 ADR-0015，取代 P-010。

## 改动
- 迁移 `0010_multi_active_practice`：删除 `ux_one_active_practice`，新增非唯一部分索引 `ix_sessions_user_active_practice(user_id, created_at DESC) WHERE mode='practice' AND state='in_progress'`；`ux_one_active_quick`、`ux_one_active_mock` 保留。downgrade 先把每用户除最新外的进行中 practice 置 `ended_early`（保留答案、不生成成绩）再重建唯一索引。0001–0009 未改；`schema.py` 与 0001 DDL 保持对齐（parity 测试）。
- 后端：`_create_session_tx` 去掉活跃预检查、原子替换与 IntegrityError→409；`PracticeSessionCreate`/`TopicSessionCreate` 去掉 `replace_active`（旧客户端多传被忽略，不会结束任何会话）；`GET /api/practice/sessions/current` 取最近创建的进行中普通练习（不再假设唯一）。草稿/提交/反馈/完成逻辑本就按 Session 与 session_unit 隔离，未改。
- 前端：删除冲突弹窗流程与 `ActiveSessionConflictDialog.tsx`、`isConflict`、`useStartPractice`/`createSession`（无调用方）、`replace_active`；`/study/practice` 点「开始练习」直接创建并进入，按钮不因旧会话禁用，失败显示普通错误。
- 文档：ADR-0015、决策表 P-010、business-rules、postgresql-schema-v0.2、M2-core-learning-flow、M2.2-frontend-implementation、frontend-spec（专项练习流程）、practice-interactions、quick-practice、ADR-0014 注记、topic-practice-next、AGENTS.md。

## 测试（实际执行）
- 后端 `pytest`（真实 PG 测试库，已迁到 0010）：197 passed、2 skipped。新增 `test_multi_session.py` 6 项：词汇进行中再开文法、各自按 Session ID 读取且反馈模式/Unit 独立；同题同 Unit 两个会话的草稿互不干扰、刷新按 ID 恢复、提交一个不影响另一个；统一反馈会话在各自 finish 前一直锁定、切换/结束别的练习不会提前提交；已提交答案不可改写、重复提交（含冲突内容）只计一次且目录/practice-status 只算一次；他人读/写草稿/提交/finish 一律 404；Quick 仍静默替换 quick 且不碰专项、DB 索引断言（practice 唯一索引已无，quick/mock 唯一索引仍在）。更新：`test_practice_sessions`（多会话不冲突、legacy `replace_active` 被忽略、/current 取最新）、`test_quick_practice`（删除 replace 测试）、`test_topic_practice`、`test_constraints_pg`。
- 迁移真实验证：开发库 `upgrade head → downgrade -1 → upgrade head` 通过；测试库造 3 个同用户进行中 practice → downgrade 后 1 个进行中、2 个 ended_early，索引恢复，再 upgrade 通过，数据已清理。
- 前端 `vitest`：27 文件通过（专项页新增「无冲突弹窗直接开始」「失败显示普通错误」两项，删旧冲突用例）；`tsc --noEmit` 通过；`npm run build` 与容器重建见下。

## 未执行 / 风险
- 未做真实浏览器验收；首页仍只展示最近一个进行中练习，未提供进行中列表/历史入口（会积累未完成会话，需要后续入口或清理策略）。
- 迁移已在开发库执行（容器 migrate 也会随重建执行）；回滚会结束多余进行中会话。
- 未推送、未部署、未合并 main。
