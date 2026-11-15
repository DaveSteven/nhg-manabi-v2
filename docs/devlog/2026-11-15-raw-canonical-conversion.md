# 开发日志 · 2026-11-15 · Raw → Canonical 转换落地与端到端复现验证

## 任务范围

用户提供 Raw 原始数据（`data/samples/N{1..5}/`，每级多套源归档 + `exams.json` 索引，共约 7.1GB，只读）。按「每级各抽一套」执行 Raw → Canonical 转换，并与既有 Canonical Archive.zip、staging 数据做端到端一致性验证。

## 改动内容

1. **收编转换器**：`canonical_v2.py`（1567 行）从 `nhg-manabi-project/Web/jlpt-spider/` 复制入本仓库 `scripts/`（只读复制，未改动源工作区）。它实现 canonical-schema v2.0 §3–§7：包结构、RichText v1 白名单 HTML 转换、§6 转换规则、§7.1 结构校验、§7.3 N2 基准。`SELECTIONS` 硬编码每级一套（N5 2018-07 / N4 2018-07 / N3 2025-12 / N2 2018-12 / N1 2018-12）。
2. **修复 staging importer 读取 bug**：`reader.py` 目录加载分支把字面量 `b""` 当 manifest 内容传入（zip 分支无此问题，测试未覆盖）。修复并新增目录加载测试。
3. `.gitignore` 增加 `data/normalized_v2/`（转换产物含完整题库与私有答案，不入库）。

## 端到端验证结果（真实执行）

| 步骤 | 结果 |
|---|---|
| Raw 转换（5 套） | 全部成功，内部结构校验（§7.1）全过、errors=[]，计数与基准一致 |
| 字节级复现比对 | 五包**所有内容文件与 Archive.zip 字节一致**；仅 `generated_at` 及其级联（import_report → 其 SHA → manifest.files 条目）不同，属 schema §3 允许的运行时元数据 |
| staging 导入 | 5 包全部 staged，content_hash 与此前 Archive.zip 导入**逐包完全相同**（如 N1 `e8f802e5…`、N2 `bc49a42f…`） |
| 幂等闭环 | Archive.zip 再导入 → 5/5 idempotent replay，库内 5 jobs / 2513 records / 1021 mappings / 0 releases 不变 |
| pytest | **31 passed**（新增目录读取测试） |
| published 红线 | `exam_releases` 等持续为 0 |

**结论**：同一 Raw 输入 → 同一转换器版本 → 字节级相同 Canonical 包 → 相同 content_hash → staging 幂等，全链路确定性成立（schema §12 重复导入验收）。

## 过程记录

- 目录导入 bug 由真实数据首次触发（此前测试只走 zip 路径），已修复并补测试。
- 本轮 `idempotent_replays: 0` 非异常：同命令链中 pytest 的 `clean_staging` fixture 先清空了 staging 表，随后是全新导入；紧接的 Archive.zip 导入以 5/5 幂等验证了哈希一致。

## 架构决策

无新增架构决策，未新增 ADR。转换器入仓是既有 Canonical v2.0 标准的工具落地。

## 剩余风险与后续

- 转换器 `SELECTIONS` 为硬编码；转换其余约 130 套归档前应改为按 `exams.json` 选择并处理重名/变体。转换产物不发布，须经审核闸门。
- 转换器依赖 macOS `afinfo` 测音频时长（跨平台回退 null）。
- staging 数据现含 5 套题库（2513 records），下一步仍是发布事务 + API 权限隔离（M1 最后一条）。
