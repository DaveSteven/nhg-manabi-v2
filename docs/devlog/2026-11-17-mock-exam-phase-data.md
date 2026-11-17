# 2026-11-17 · 严格模拟 Phase 数据（ADR-0019 首步）

## 范围
只做数据层：让 Canonical 包能携带 Phase（计时阶段）并发布进 Release 快照。**不做**模考会话/计时/接口/前端，不重新转换、不入库、不发布真实内容。

## 设计与取舍
- 新增可选 Canonical 文件 `phases.jsonl`（`record_type=exam_phase`）：`id/exam_id/position/title/duration_seconds/subjects/playback_policy/rule_source/rule_checked`。文件缺省 = 无模拟入口，不写空文件。
- 内容哈希：`phases.jsonl` 放在 `FILE_ORDER` 末尾，缺省包哈希不变（旧导入不受影响）；加入 Phase 后哈希变化 → 新 Release 修订，符合「已发布 Release 不可改」。
- Unit 归属由 `subjects` → Layer 科目推导（不重复存 unit 列表），发布时按 Section→Layer→Unit 顺序写入 `release_phase_units`；校验保证每个 Unit 恰属一个 Phase、无空 Phase。
- 规则表在转换器 `PHASE_RULES`（N1/N2 两个 Phase，N3–N5 三个 Phase；时限取自 jlpt.jp，核对日 2026-11-17），听力 Phase 带严格播放策略。缺任一所需科目（或未知级别）的试卷整体不生成 Phase（M10），并记 `phases_skipped` 警告。
- 规则表没放进后端：转换器与后端相互独立，后端只信任 Release 里的 Phase 数据。

## 改动
- `scripts/canonical_v2.py`：`PHASE_RULES`、`build_phases`、写 `phases.jsonl`、manifest 文件清单与 counts、新增 `--all --overwrite`（默认仍跳过已存在包）。
- 后端：`reader`（可选读取、counts 校验）、`hashing`、`staging`（暂存记录类型）、`validator`（`_validate_phases`）、`publisher`（`_insert_phases`/`_insert_phase_units`）；`tests/conftest.py` 清理表补两张 Phase 表。
- 文档：`canonical-schema-v2.0.md` 新增 §4.10a。无 Schema/Alembic 变更（表早已存在）。

## 测试（实际执行）
- 后端 `pytest`（真实 PG 测试库）：**235 passed、2 skipped**。新增 `test_exam_phases.py`：五个级别规则表逐项对照官方分钟数、科目恰好分属一个 Phase、听力策略、缺科目/未知级别返回 None、无 Phase 包哈希不变且仍有效、Phase 令哈希变化、12 种非法 Phase 被拒、发布写入 phases 与 unit 归属（顺序、每 Unit 一次）、无 Phase 包发布后无 Phase 行。`test_importer` 的 counts 断言补 `phases`。
- 真实数据验证（不触碰开发库）：用转换器把 N2 2018-12 原始数据转到临时目录——其余 7 个文件与现有 `normalized_v2` 包逐字节一致（确定性）；`load_archive`+`validate_package` 0 错误；在**临时库** `nhg_phasecheck`（迁移到 head）暂存并发布为 draft：2 个 Phase（6300s/3000s，听力有策略），59+29 = 88 个 Unit 各归属一次；验证后已删除临时库与临时文件。

## 未执行 / 风险
- **现有 105 套库内试卷仍无 Phase**：需要 `canonical_v2.py --all --overwrite` 重新转换（覆盖本地被忽略的 `data/normalized_v2`），再重新导入——会为每套产生新 revision，在 `PUBLISH_POLICY=auto` 下**导入即发布**，会改动本机开发库当前发布，故未执行，待你决定。
- 另有 3 个包缺听力科目（规则上不生成 Phase），其模考入口将不显示。
- 模考是否可用还应要求所有 Unit `conversion_status=complete`、音频资产可用；这属于后续模考后端的开始条件，本步未实现。
- 未推送、未部署、未合并 main。
