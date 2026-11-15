# Canonical v2.0 → PostgreSQL 导入规范（M1）

> Canonical 数据格式的字段权威文件是 `docs/architecture/canonical-schema-v2.0.md`，数据库结构是 `docs/architecture/postgresql-schema-v0.2.md`。本文件描述导入状态机、验收与防重复执行，不代替上述 schema。

## 数据输入

每份 Canonical 数据包包含 `manifest.json`、`exam.json`、`sections.jsonl`、`layers.jsonl`、`question_types.jsonl`、`units.jsonl`（含 Materials）、`questions.jsonl`（含 Options）、`answer_keys.private.jsonl`、`explanations.jsonl`、`assets.jsonl`、内部 provenance/报告。

真实媒体的文件二进制不必嵌入 JSON 包，但导入器必须检查资产存储可访问性、真实 MIME、SHA-256 和（如存在）音频时长。`Archive.zip` 是开发阶段提供的**结构样本**，不得当作完整媒体交付或审核完成证明。

## 入口事务

```text
1. 检查 package/schema_version、manifest file SHA256/bytes
2. 计算稳定 content_hash，排除 generated_at 等运行时间元数据
3. 按 (package_id,content_hash) 查询 import_jobs：已处理则幂等返回
4. 解析并校验 Section→Layer→Unit→Question→Option→AnswerKey
5. 验证 richtext slot、字幕 cues、媒体引用、打印题号、不允许静默丢失
6. 写 staging import_records + source_mappings + report，状态 draft
7. 交 Agent / 人工审核；处理修订后生成新的候选 content hash
8. 发布申请通过后，单一事务写 release 快照并切 current release 指针
```

**严禁**直接从 ETL 输入写入公开 `published`。任何出现 `needs_review/blocked` 的关键材料（如 A/B 对比切分）不得自动过发布闸门。

## ID/版本/哈希

- 运行时 ID 必须为 JLPT GO Canonical 稳定 ID；`source_system/source_object_id/raw_node_hash` 在内部映射表，禁止用其作为用户 API 主键。
- `(package_id,content_hash)` 形成可重入同一 import job；相同内容重复发布同一逻辑 Exam 不生成第二个 release。
- 内容 release 内 Question、Unit、Option、AnswerKey 以 `(release_id,canonical_id)` 复合外键；禁止跨 release 错绑。
- 源文件名可能乱码、扩展名与媒体文件签名不一致，使用文件二进制签名而非后缀判断真实 MIME；无法验证资产则标记不可用。

## 校验列表

- 每份包：manifest 数量核对；JSON/JSONL 行完整；同父 position 唯一、ID 唯一、外键可解析。
- `single` Unit 恰好一 Question；每个 Unit 至少一题；cloze slot 按稳定 ID 唯一绑定；一个 A/B 题应有完整对比材料。
- 答案正确选项必须属于该题；保存正确索引转换关系，不凭来源 `right_answer` 任意改变含义；不硬编码 4 个选项。
- `printed_number` 为字符串，保留 01/1番/質問1；允许 `prompt=null` 看图/听力题，必须有足够可用媒体材料。
- `review_status=unverified` 不代表质量通过；对外公开受内容审核与授权许可限制。

## 样本结构基准

N5/N4/N3/N2/N1 五套验证样本共 **20 Section / 83 Layer / 440 Unit / 498 Question / 204 Asset**。N2 单套 **19 Layer、41 显式材料组、47 独立单题、88 Unit、103 Question、37 Asset**。源端 498 叶子题 ↔ Canonical 498 题映射结构验证通过，但不等于原始解析或答案全正确。

已知待复核：读解 question_types 32–36 语义标签、N1/N2 A/B 文章启发式切分、字幕图片占位符、文件名/真实 MIME、原始 ZIP 未保留时的归档指纹替代策略；原报告 `slot_binding.bound` 的计数需要重新检查。

## M1 完成条件

- 在**真正的 v2 PostgreSQL 开发库**成功执行 `alembic upgrade head`；能完成基本连接/约束验证。
- 五套输入 staging 导入的计数和关联完全吻合，第二次导入无重复记录且不更新发布库。
- 导入失败回滚且留下诊断，不丢失原始记录或悄悄修正问题。
- 测试账号能通过授权的内部 API 查询 N2 文法五空组和三篇阅读材料，答案在公开 API 中不可见。
