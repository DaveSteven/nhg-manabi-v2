# 2026-11-17 · user_question_progress 缓存 + 专项「只复习最近仍错」

## 范围
专项练习收尾两项（用户确认）：① 接入 `user_question_progress`（此前仅有表定义）作为从正式作答派生的每题缓存；② 专项练习新增「只复习最近仍错」出题范围。严格模拟（规则未定）与统计模块不在本次范围。不改 Schema，无 ADR（沿用 business-rules 对该缓存的既有定义，未改变需求/架构）。

## 改动
- `backend/app/question_progress.py`：单条 UPSERT 从 `study_submitted_answers`（practice + quick_practice，不含草稿）**重算**受影响题目，而非自增，因此幂等、可整体重建。语义：`attempt_count` = 有实际选择的作答次数，`skip_count` = 正式提交但未选，`last_valid_result/last_answered_at` 只跟随有选择的答案（skip 不覆盖最近正误），`last_seen_*` 跟随任意提交。
- 维护点：`_judge_and_store_unit`（逐 Unit 提交与统一反馈整次提交共用，Quick 经逐 Unit 提交）在同一事务内刷新，回滚时一并回滚；该函数增加 `user_id` 参数。
- 迁移 `0012_backfill_question_progress`：纯数据迁移，用同一语句回填历史作答；downgrade 清空缓存（派生数据）。
- 专项 API：`GET types` 新增 `wrong_units`；`POST sessions` 新增 `selection: smart|wrong_only`（默认 smart，写入 `config.topic.selection`）。`wrong_only` 候选＝当前发布 Unit 中至少一题 `last_valid_result = false`，按仍错题数加权无放回抽取，整 Unit、不拆分、不用未做错的 Unit 补足；无则 422 `no_wrong_units`，超量沿用 `count_exceeds_available`（`available_units` 为仍错池大小）。智能抽样的「已答/最近仍错」历史改读缓存，其余（提交次数、最近时间）仍来自会话表。
- 前端：配置页新增「出题范围」单选（智能抽题 / 只复习最近仍错（N 组），无仍错时禁用），数量上限随池大小；题型卡显示「仍错 N 组」；结果页「再练一组」沿用 `selection`，仍错耗尽时给出说明。旧会话无 `selection` 按 smart 解析。

## 测试（实际执行）
- 后端 `pytest`（真实 PG 测试库）：**212 passed、2 skipped**。新增 `test_question_progress.py`：提交后计数与 skip 不覆盖最近正误、统一反馈整次提交也更新、删除后 `rebuild_user_progress` 与增量结果一致且幂等、wrong_only 目录/创建/超量/答对后消失/skip 不清除、他人隔离与无答案泄漏、默认 smart 并记录、纯函数 `select_wrong_units`。`test_topic_practice` 配置断言补 `selection`。
- 迁移真实验证（开发库）：`upgrade`（回填 34 行，源 39 条作答）→ `downgrade -1`（0 行）→ `upgrade`（34 行）通过。
- 前端 `vitest`：30 文件 / **257 passed**（新增 wrong_only 配置页、模型边界、结果页沿用 selection 与耗尽提示）；`tsc --noEmit` 与 `npm run build`（含构建检查）通过。

## 未执行 / 风险
- 未做真实浏览器验收，容器未重建；未对真实开发库跑 wrong_only 接口冒烟。
- 缓存按正式作答重算，历史 release 变更不会改动旧答案；若将来增加管理端改答案键，不影响缓存（缓存只记作答时的判定）。
- 缓存有 `last_valid_result` 索引，但未对大数据量做性能评估；`practice-status` 等其他查询仍直接读会话表。
- 同毫秒并发提交同一题时 `last_valid_result` 取决于 `submitted_at` 排序，未加次级排序键（单用户单名额下可忽略）。
- 模拟考试规则文档、错题本/学习历史/统计尚未开始。未推送、未部署、未合并 main。
