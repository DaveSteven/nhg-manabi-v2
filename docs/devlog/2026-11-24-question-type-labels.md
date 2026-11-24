# 2026-11-24 题型中文名规范

- 审查 `question_types.label_zh`：「文脉规定」「造语」是日语汉字直转，中文不通顺；「用法」过于笼统。其余 18 项保持不变。
- 改名（用户 2026-11-24 确认「规范一下」）：文脉规定→**语境填空**、造语→**词语构成**、用法→**词语用法**。
- 改动：Alembic `0021_question_type_labels_zh`（仅 UPDATE 显示名，带条件，可回滚）；`scripts/canonical_v2.py`、`v1_book_convert.py` 同步新名。发布器对 `question_types` 为 `ON CONFLICT DO NOTHING`，重导入不会还原。ID、Canonical 内容与 release 哈希不变，已有 `data/normalized_v2/*/question_types.jsonl` 未改（仍是旧名，仅作历史产物）。
- 验证：开发库 up → down（回到旧名）→ up（新名）通过；`test_migration_parity` 2 passed；api 容器已重建。未跑后端全量；浏览器未核对。
- 风险：生产库（现为 V1，v2 已停）未处理；上线 v2 时迁移会随升级执行。
