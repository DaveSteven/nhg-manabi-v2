# Canonical Schema v2.0 跨等级验证报告

> 日期：2026-11-15
> 转换器：`canonical_v2.py`（`canonical_v2.0-converter+0.1.0`）
> 输入：`data/N{1..5}/` 各选定一套原始包；输出：本目录 `JLPTGO-*-r1/` 数据包

## 验证样本

| 等级 | 包 | 会期 | Layer | Unit | Question | Asset | 说明 |
|---|---|---|---:|---:|---:|---:|---|
| N5 | KDXBNKaPMJ | 2018-07 | 14 | 86 | 91 | 43 | |
| N4 | yxeDN6rPmR | 2018-07 | 15 | 90 | 98 | 46 | |
| N3 | JIcIGb0sPS | 2025-12 | 17 | 90 | 101 | 36 | 最新抓取版式 |
| N2 | 1EPlaLzGnX | 2018-12 | 19 | 88 | 103 | 37 | schema 基准样本 |
| N1 | mvgz7C99A7 | 2018-12 | 18 | 86 | 105 | 42 | |

## 结果（对照 schema §7）

1. **N2 基准完全吻合（§7.3）**：19 Layer / 41 显式材料组 / 47 单题 Unit / 88 Unit / 103 Question / 37 MediaAsset，全部一致。
2. **逐题对照**：498 道源叶子题 ↔ Canonical Question 1:1，选项文本（去 HTML 后）、正确答案 0 基索引、印刷题号全部一致，无静默丢失（§12 第一条）。
3. **结构校验（§7.1）**：5 包全部通过（ID 唯一、外键可解析、position 唯一、单选答案属于本题选项、cloze slot 绑定、媒体引用可解析、资源哈希核验 verified）。
4. **幂等性（§12 最后一条）**：同一输入两次转换，全部内容文件字节级一致；仅 manifest/import_report 因 `generated_at` 时间戳不同（schema §3 允许：内容哈希排除运行时间/导入日志）。
5. **RichText v1（§5）**：`p/u/br/div` 白名单转换、`<u>`→underline marks、`<MOJiTest_URL>` 占位符不输出为 URL、全角空格/标点保留；N2 词汇题输出与 schema §5 示例（「二人は離れて座った。」）形态一致。
6. **翻译归属（§6）**：材料组 `translation` → Unit 级 Explanation(zh-CN)；叶子 `analysis` → Question 级 Explanation(zh-CN)；`analysisisOk` 只存 provenance，不提升审核状态（全部 `unverified`）。

## 跨等级结构发现

- 源树仅 `dataType=20/21/22` 三种节点，各等级一致；题型整数 11–16（词汇）/ 21–23（文法）/ 31–36（读解）/ 41–46（听力）全覆盖，schema §4.4 的 subject 映射成立。
- **印刷题号有三种形态**：`*01`（文字/文法/读解）、`*1番`（听力）、`*03*質問1`（听力統合理解，一份音频多道印刷题）——`printed_number` 保留原样字符串，验证了 schema「printed_number 可能不同于 position」的设计必要性。
- **cloze slot**：锚点形态统一为 `（　48　）`，与子题印刷题号可唯一绑定；5 包各 1 个文法文章題 Unit，slot 全部绑定成功、无 needs_review。
- **对比读解（A/B）**：N2 ly-12、N1 ly-11 各检出 1 组統合理解，已切分为 `comparison_a/comparison_b` 两个 Material 并标 `needs_review`（启发式切分，需人工复核）。
- **Unit kind 分布**：single / passage / cloze / comparison / audio 五种均有实例，覆盖 §4.6 枚举（visual 未在本批出现，読解情報検索图片走 Material kind=image）。

## 发现的数据质量问题（已入各包 import_report.json）

| 问题 | 位置 | 处理 |
|---|---|---|
| `.jpg` 扩展名实为 PNG 签名 | N1 `bdf6b05d….jpg` | MIME 按文件签名修正，warning 记录（§4.10） |
| 字幕含 `<MOJiTest_URL>` 图片占位符（看图听力） | 全等级 143 处 | 占位符不入字幕文本；对应图片已挂在 Question.media_asset_ids |
| 题干为纯图片占位符 | N5×13 / N4×12 / N3×5 / N2×1 / N1×1 | prompt=null + Question 级 image 资产（§5.3） |
| 材料正文为图片占位符（情報検索） | 每等级 1 处 | passage 由 g21 `imageId` 图片 Material 替代 |

## 遗留事项

1. **question_types 语义字典（§11.4）**：读解 32–36 的语义 ID 为暂定（`reading_short_set/medium/integrated/long/information_search`），各包 import_report 的 `provisional_question_types` 已列出，需对照实际试卷版式人工确认后定稿。
2. **原始 ZIP 未随抓取保留**：`source_archive_sha256` 使用「解包目录批摘要」（相对路径+文件 SHA-256，算法 v1）替代，已在 import_report 说明；后续抓取应保留原始 ZIP 以便真正的归档指纹。
3. **duration_ms**：通过 macOS `afinfo` 测得，全部音频均已取得；跨平台转换时缺失则应回退 null（字段允许）。
4. 本批输出全部为 `state=draft`、`review_status=unverified`，不得当作已校验题库发布（§7.2）。
