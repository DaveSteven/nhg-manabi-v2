# 开发日志 · 2026-11-15 · Canonical Staging Importer

## 任务范围

实现 Canonical v2.0 → PostgreSQL 导入状态机的 **staging 部分**（import-spec 步骤 1–6）：验包 → content_hash → 幂等检查 → 结构校验 → 写 `import_jobs` / `import_records` / `source_mappings`。发布事务（步骤 8）不在本次范围。

## 改动内容

新增 `backend/app/importer/`：

| 文件 | 职责 |
|---|---|
| `reader.py` | 从 zip/目录加载包；校验 `schema_version=2.0.0`、manifest 文件 SHA256/字节数、counts 与实际行数、JSONL 逐行完整性 |
| `hashing.py` | 确定性 `content-hash-v1`：键序无关、排除 `generated_at` 等运行时字段、排除 manifest/provenance |
| `validator.py` | 结构校验：ID 唯一、FK 可解析、同父 position 唯一、single Unit 恰好一题、选项 ≥2、答案键必须属于本题、cloze slot 绑定、RichText v1 白名单、cues 时间轴、printed_number 字符串、媒体引用；error 阻断 / warning 记录 |
| `staging.py` | 单事务写入三张 staging 表；`(package_id, content_hash)` 幂等返回；失败回滚 + 诊断文件（`data/import_reports/`，不入库）；`source_mappings` 按唯一约束幂等（跨作业稳定注册表） |
| `__main__.py` | CLI：`python -m app.importer <Archive.zip>` |
| `errors.py` | `PackageReadError` / `ChecksumError` / `ValidationError` / `StagingError` |

新增测试：`tests/importer_fixture.py`（合成标准包生成器）、`tests/test_importer.py`（30 个测试中 19 个新增；哈希稳定性、8 类结构违规、篡改校验、幂等、回滚、staging-only 红线等）。

## 与文档的不一致（按 AGENTS.md 列出）

真实数据包与 `canonical-schema-v2.0.md` 草案存在差异，导入器以实际转换器输出为准：

1. **Layer 无 `section_id` 字段**，实际用 `(exam_id, section=subject)` 指向 Section（§4.5 写的是 `section_id` FK）。验证器已按实际格式解析。**建议后续修订该文档或转换器**。
2. **Material 无 `position` 字段**，数组顺序即权威顺序（§4.6 字段表未列 position，一致；但 DB 投影有 position，发布时按数组序赋值）。
3. `question_types` 实际带 `source_type_code`、`_provisional` 字段（文档写 `is_provisional`）；assets 的 `record_type` 是 `media_asset` 而非 `asset`。
4. manifest 已带转换器自算的 `content_hash`；导入器用自己的 `content-hash-v1` 作幂等键，两者不一致时记 warning（算法不同属预期）。

以上均已在验证器中以实际格式实现并在本日志记录；未擅自修订规范文档。

## 实际执行的测试与结果

真实执行，无虚报：

| 检查 | 结果 |
|---|---|
| `pytest`（全量） | **30 passed, 0 failed**（含 DB 约束 5、导入器 19、其余 6） |
| `verify_canonical_archive.py`（真实包） | 5 包校验和通过，总计 20/83/440/498/204 |
| CLI 导入真实 `Archive.zip` | **5 包全部 staged**，计数逐包核对吻合：N1 18L/86U/105Q/42A，N2 19L/88U/103Q/37A，N3 17L/90U/101Q/36A，N4 15L/90U/98Q/46A，N5 14L/86U/91Q/43A |
| DB 计数 | import_jobs=5（全部 `staged`）、import_records=2513（=5+20+83+83+440+498+498+682+204）、source_mappings=1021 |
| 第二次导入 | **5 个全部幂等返回**，jobs/records 数量不变 |
| 红线检查 | `exam_catalogs`/`question_registry`/`exam_releases`/`exam_current_releases`/`release_sections` 均为 0 行 |
| M1 抽查 | N2 文法問題9：1 Unit、5 slot_ids、5 Question，slot 绑定校验通过 |
| 期望 warning | N1 `ly-11-u01`、N2 `ly-12-u01` A/B 对比单元 `needs_review`（6 条 records 标记），符合规范「启发式切分不自动过闸门」 |

**未执行的检查**：ruff/mypy（仍未配置）；导入器未验证媒体二进制（Archive 内只有元数据，`availability=verified` 来自转换器，导入器对此如实透传、不作背书）。

## 架构决策

无新增架构决策（staging-only 边界、幂等键、稳定 ID 均为既有 ADR/规范落地）。未新增 ADR。

## M1 完成度与剩余风险

已完成：真实开发库迁移（上一任务）、五套包 staging 计数与关联吻合、重复导入无重复且不碰发布库、失败回滚+诊断。

**未完成（下一任务）**：M1 最后一条——发布事务（写不可变 release 快照 + 切 current 指针）+ 内部/公开 API 权限隔离验证（N2 文法五空组可查、答案公开 API 不可见）。staging 数据已就绪，发布流程可直接基于本次 staged 内容开发。

风险：Layer/Section 关联与文档草案不一致（见上）；`answer_keys` 在 staging 表内以普通 jsonb 存储，公开 API 层必须显式过滤 `record_type='answer_key'`。
