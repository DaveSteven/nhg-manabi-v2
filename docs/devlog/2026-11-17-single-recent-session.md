# 2026-11-17 · 专项练习单一最近进度（ADR-0016）

## 范围
用户撤销「多个进行中练习」方案：每个用户只保留一份可恢复的专项练习，开始新练习时自动 `abandoned` 旧的，无弹窗；已提交答案/历史保留，未提交草稿不计成绩。新增 ADR-0016，取代 ADR-0015；清理文档中互相矛盾的多 Session 表述。不做多练习列表、批量清理、历史草稿管理；Quick Practice 与严格模考不变。

## 改动
- 迁移 `0011_single_active_practice`：删除 0010 的非唯一索引，恢复部分唯一索引 `ux_one_active_practice`（`mode='practice' AND state='in_progress'`）；升级时先把每用户除最新外的进行中 practice 置 `abandoned`（答案保留、无成绩）。downgrade 回到 0010 形态。0001–0010 未改。
- 后端：`_create_session_tx` 改为「校验所有 Unit → 同事务 `UPDATE … SET state='abandoned', ended_at=now(), version+1` → INSERT 新会话」，任何失败整体回滚（旧练习不丢）；并发开始在唯一索引上竞争，落败者重试一次（后来者胜），再冲突才 409 `session_replace_conflict`。专项抽样接口复用同一事务；`replace_active` 仍被忽略。`abandoned` 会话只读：草稿/提交/结束沿用 409 `session_not_active`，结果接口新增 409 `session_abandoned`。`/current` 即唯一可恢复练习。
- 历史口径：目录计数、抽样历史、practice-status 不区分会话状态，故 abandoned 会话已提交答案继续计入；其未提交草稿从不进入成绩/历史。
- 前端：DTO 增加 `abandoned` 状态；统一反馈/逐 Unit 页面对 abandoned 显示「已被新的专项练习取代」且只读；结果页对 `session_abandoned` 显示说明而非成绩。无冲突弹窗（ADR-0015 时已删除）。
- 文档：ADR-0016（ADR-0015 标记为已取代）、决策表 P-010、business-rules、postgresql-schema-v0.2、M2-core-learning-flow、M2.2-frontend-implementation、frontend-spec、practice-interactions、quick-practice、topic-practice-next、AGENTS.md。

## 测试（实际执行）
- 后端 `pytest`（真实 PG 测试库）：205 passed、2 skipped。`test_single_session.py`（取代 `test_multi_session.py`）8 项：新开始不冲突地 abandon 旧练习且已提交答案/计数保留、`/current` 为新会话；abandoned 会话冻结（草稿/提交/结束 409、结果 409 `session_abandoned`、无结果行、草稿不计历史、他人 404）；失败的开始（不存在 Unit、数量超限、无候选）不丢旧练习；刷新恢复当前会话草稿与题目顺序；完成后 `/current` 404 且结果保留、下次开始不改动已完成会话；连续 4 次开始仅剩 1 个进行中且不影响其他用户；4 线程并发开始最终仅 1 个进行中；Quick/模考槽位独立并断言三个唯一索引均存在。改写 `test_constraints_pg`（二次插入被唯一索引拒绝，abandoned 不占槽）、`test_practice_sessions`、`test_quick_practice`、`test_topic_practice`、`test_unified_submit`。
- 迁移真实验证：开发库 `upgrade → downgrade -1 → upgrade` 通过；测试库降级到 0010 后造 3 个同用户进行中 practice，升级后为 1 个 in_progress + 2 个 abandoned，索引为 ux_one_active_practice/quick/mock，数据已清理。
- 前端 `vitest`：28 文件 / 246 passed（新增 abandoned 只读视图、结果页 abandoned 说明）；`tsc --noEmit` 通过；构建与容器重建见提交。

## 未执行 / 风险
- 未做真实浏览器验收。
- 用户开始新练习即永久放弃旧进度（已提交部分保留）；没有「确认后再替换」的保护，按用户指示。
- abandoned 会话仍可经 `GET /api/practice/sessions/{id}` 只读访问，但前端无入口（不做历史管理）。
- 未推送、未部署、未合并 main。
