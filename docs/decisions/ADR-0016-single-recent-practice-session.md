# ADR-0016 专项练习：单一最近进度，新开始即替换（abandoned）

状态：已接受（用户 2026-11-17 指示）。**取代 ADR-0015**（多个进行中练习）与 P-010 原「继续/结束旧练习」冲突弹窗方案。

## 决定

1. 每个用户只保留**一份**可恢复的 `mode='practice'` 进行中 Session。数据库恢复部分唯一索引
   `ux_one_active_practice`（Alembic 0011；0010 的非唯一索引删除；0001–0010 未改）。
2. 开始新专项/普通练习时，同一事务内先把旧的 `in_progress` Session 置为 `abandoned`（写 `ended_at`、`version+1`），
   再创建新 Session。校验失败或创建失败整体回滚，**旧练习不会丢**。两个并发开始请求在唯一索引上竞争，
   落败者重试一次（等价于「后来者胜」），仍冲突才返回 409 `session_replace_conflict`。
3. 不弹冲突弹窗，不要求用户手动结束；不再有 409 `active_session_exists`、`replace_active`（旧客户端多传被忽略）。
4. 旧 Session 的已正式提交答案、历史与目录计数保留（抽样历史、practice-status 不区分会话状态）；
   其未提交草稿不参与成绩计算，也不会被转正。`abandoned` 会话只读：草稿/提交/结束均 409 `session_not_active`，
   结果接口 409 `session_abandoned`（不产生成绩）。
5. `GET /api/practice/sessions/current` 返回当前唯一可恢复 Session，首页「继续上次练习」只展示它；刷新当前练习恢复答案与进度（草稿/题目顺序不变）。
6. 正常完成（统一反馈整次提交、或即时反馈 finish 且全提交）后保存正式结果，会话变为 `completed`，不再是可恢复状态；
   已完成会话保留自己的 `study_results`，下次开始不会改动它。
7. 不做多个未完成练习列表、批量清理或历史草稿管理。
8. Quick Practice（`ux_one_active_quick`，静默替换为 `ended_early`）与严格模考（`ux_one_active_mock`）规则不变。
9. 只保留一份**临时练习进度**，不等于只保存最后一次正式成绩：所有已完成会话的结果与正式答案永久保留。

## 迁移

升级时若存在 0010 期间产生的多个进行中 practice，每个用户保留最新一个，其余置 `abandoned`（答案保留、不生成成绩），再建唯一索引。
降级恢复 0010 形态（非唯一索引）。

## 后果

- 用户同时只能有一个未完成专项练习；想做别的会让旧的变为 abandoned（不可再恢复，已提交部分保留）。
- ADR-0015 保留作历史记录，其「多会话」条款不再有效。
