# 2026-11-19 · V1 真题专项作答迁移脚本

## 范围
ADR-0030：把 V1 真题专项练习（`practice_attempts`/`practice_attempt_answers`）迁成 v2 正式答案。本次只交付脚本与合成数据测试；**未对线上 V1 做 dry-run**。

## 改动
- `app/v1_answer_import.py` 增加 `--kind exam`：题映射 = V1 `identity_json` →（原始 `exam.json` 的 identity ↔ objectId）→ `source_mappings(mojitest)` → v2 题；同一 attempt 内同 Unit 的答案共用 session unit，只写真正作答的题，不伪造未答；会话 `config.imported`；教材与真题共用重判、跳过分类、幂等与进度重建逻辑。
- `learning.py`：练习历史与完成会话数排除 `config.imported` 会话（其答案仍计入覆盖率/仍错/抽样）。
- 学生端 DTO：`config.imported` 可选字段。

## 测试
- 后端 `pytest -q`（真实本地 PG 测试库）：327 passed, 2 skipped（新增 `test_v1_exam_answer_import.py` 4 项：identity→objectId→canonical 链、dry-run/幂等、按 v2 Key 重判与未映射跳过；组题 Unit 共用 session unit 且不伪造未答；导入答案计入进度但不进历史（去掉过滤后该测试失败，已变异验证）、结果接口不崩；快照 Key 不一致被跳过）。
- 学生端 `tsc --noEmit` 通过。

## 未执行 / 风险
- 未对线上 V1 的真题作答做 dry-run：需连接线上 V1 库，并在测试库先导入真实真题内容（`data/normalized_v2`，含媒体检查）、7 个用户与原始 `data/samples` 映射；真实跳过比例与改判数量未知。
- V1 专项练习历史不会出现在 v2「练习历史」里（只迁答案与统计）。
- 开发库/生产尚未导入任何 V1 数据。
