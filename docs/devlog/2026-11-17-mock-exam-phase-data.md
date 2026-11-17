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

## 全量重新转换与导入（用户授权，本机开发库）
- 备份：`pg_dump` → `.local/backups/nhg_manabi_v2-pre-phases-2026-11-17.dump`；旧包目录 → `.local/backups/normalized_v2-pre-phases`（均 gitignored）。
- 转换：`canonical_v2.py --all` 输出到并列的新目录（未直接覆盖）：105 套成功、N3 2013-12 仍因源数据 `null` 节点失败（与本次无关）。与旧包逐文件比较：9 个内容文件**零差异**，仅多 `phases.jsonl`；换入后保留原 N2 2018-12 的 r2/r3/r4 子集包。
- 导入：逐包 `python -m app.importer`（auto-publish）：105 个包 105 个 ok、0 失败、105 个新 release 自动发布并成为 current（日志 `.local/import-phases-2026-11-17.jsonl`）。
- 核对（开发库，current releases）：105 套全部有 Phase；N1/N2 各 2 个（32+32 套）、N3 3 个（28）、N4 3 个（7）、N5 3 个（6）；**每个 Unit 恰属一个 Phase：违规 0**；空 Phase 0；可见/隐藏 Unit 仍为 9151/74（与入库时一致）；学习会话 63 条与进度缓存 34 行未变；`/api/exams` 仍返回 105 套。
- Unit ID 未变，历史与进度不受影响；进行中的练习仍固定在其开始时的旧 release。

## 未执行 / 风险
- 本次是对本机开发库的操作；未部署、未推送。旧 release 仍留在库中（非 current）。
- 仍无任何接口读取 Phase：模考会话/计时/接口/前端未开始，因此尚无用户可见变化。
- 模考可用性还应要求 Unit `conversion_status=complete`（74 个隐藏 Unit 所在的试卷）与音频资产可用，留给模考后端。
- 模考是否可用还应要求所有 Unit `conversion_status=complete`、音频资产可用；这属于后续模考后端的开始条件，本步未实现。
- 未推送、未部署、未合并 main。
