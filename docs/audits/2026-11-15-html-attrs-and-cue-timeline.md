# 审计报告 · 原始 HTML 属性与字幕时间轴（M1.5）

> 日期：2026-11-15
> 范围：五套已转换样本（N5/N4/N3/N2/N1，`data/samples/N*/` 每级一套）的原始 HTML 与 Canonical 输出
> 工具：`scripts/audit_canonical_html.py`（残留扫描）、`scripts/canonical_v2.py`（转换器属性审计，+0.1.1）、`backend/tests/test_playback_compatibility.py`

## 1. 原始 HTML 标签与属性清单（结构化扫描，逐属性计数）

| 标签 | 属性 | 出现次数（属性级） | 分类 | 处理 |
|---|---|---:|---|---|
| `p` | `class` | 9024 | **A 可移除**（上游 UI 类名，如 `moji-content`） | 转换器已丢弃；新增属性审计计入 import_report `source_attr_audit` |
| `p` | `data-starttime` / `data-endtime` | 4512 + 4512 | **B 必须转换** | `H:MM:SS[.,]mmm` → 整数毫秒；空值见下 |
| `u` | `style`（`text-decoration: underline double`） | 3（N5 同一处 ×3 份冗余文件） | **B/A 之间**：空标签（`<u style=…></u>` 无文本），双下划线语义无可见内容 | 丢弃不损内容；**新增 `style_semantics` 警告**（question `…ly-01-u10-q01`），不再静默 |
| `u` | `underline`（属性名） | 3 | **A 可移除**（与标签语义重复） | 已丢弃，入审计 |
| `u` | `double`（属性名） | 3 | 同上（style 声明的另一份冗余） | 已丢弃，入审计 |
| 未白名单标签 | — | 0 额外（`<MOJiTest_URL>` 占位符既有处理） | C 占位符 | 保留计数、不输出为 URL、对应图片挂 Question 媒体（既有实现） |

**属性级空时间值**：1812 个 `data-starttime`/`data-endtime` 值为空 = **906 个段落**（各等级阅读/词汇 HTML 模板段落，如「（一）ニンさんのさくぶん」及正文）。这些段落**带真实日文文本**：经 `parse_richtext` 走正文路径时保留为普通段落（空时间属性本无数据可转换）；进入字幕路径的会生成**无时间戳 cue**（保留文本、计数入 `cues_missing_time`、验证器标 `needs_review`）。**无任何文本被丢弃**。

**时间戳单位核实**（§3.1）：可解析值全部为 `H:MM:SS.mmm`（7212/7212 非空值，含逗号/句点毫秒分隔两种），**源单位为时分秒+毫秒**，`parse_time_ms` 换算为整数毫秒正确；未发现纯秒数或 `MM:SS` 格式。

## 2. Canonical 残留扫描结果（§5）

对五包的 Question.prompt / Option.content / Material.content / Explanation.content / Cue.text 结构化遍历：

| 检查项 | 发现数 |
|---|---:|
| 未转换 HTML 标签 | **0** |
| `<MOJiTest_URL>` 残留 | **0** |
| class/style/data- 属性残留 | **0** |
| 异常 HTML 实体 | **0** |
| cue 内原始标签 | **0** |
| 非 RichText v1 结构 / 未知 block 类型 | **0** |

已知的 143 处 `<MOJiTest_URL>` 字幕占位符（看图听力）按既有规则处理：不进入字幕文本，对应图片挂 Question.media_asset_ids，import_report 记录——扫描确认 Canonical 中无残留。

## 3. 字幕时间轴验证（§3）

**覆盖率**：143/143 个含字幕 Material 均配对恰好一个音频 Material（asset_id 可解析）；**1202/1202 cue 全部具有整数毫秒 `start_ms`/`end_ms`（覆盖率 100%，无缺失、无不可解析）**；`index` 连续 1..n；文本（含说话人标记「男：」「女：」）完整保留于 `children`。

**时间轴基准**（§3.5）：**相对于 Unit 自身的音频 Material**，而非整卷音频——全部 143 个 Unit 的 cue 时间界与该 Unit 音频的 verified `duration_ms` 吻合（下述例外除外）；整卷音频（exam.full_audio_asset_id）与字幕时间轴无直接关系。

**边界与异常**：
- `start_ms >= 0`、`end_ms > start_ms`：1202/1202 全部合法（0 值起始为合法值，与「缺失」区分——验证器现以 `cue_time_missing` / `cue_time_invalid` 两种警告码区分）。
- **越界（cue_over_duration）21 个 Unit**：cue 末段超出音频 verified 时长。多数为 16–70ms（编码器 padding 量级）；N4 `ly-15-u01/u04/u05`（373–980ms）与 N5 `ly-14-u02`（143ms）偏大。**全部标 needs_review，不猜测截断**；清单由 `test_timeline_relative_to_unit_audio_and_overrun_list` 固化回归。
- **大间隔（cue_gap_large）20 个 Unit**：段间 10–26 秒空隙，模式符合听力题型「問題の例」前导说明间隔，标 needs_review 供人工确认，不视为错误。
- 重叠/倒序：0。
- 区分缺失与 0：验证器已区分（本批数据无缺失项）。

## 4. 逐段播放兼容性（§4）

`tests/test_playback_compatibility.py` 以纯数据测试验证 Canonical cues 可支撑：点击段落从 `start_ms` 定位（每段有效起止点）、`end_ms` 自动暂停（合法区间）、重复播放（任一 `[start,end)` 可循环）、顺序下一段（index 连续、无重叠）、AB 循环（任一时间对）、全文连续播放（min start → max end 边界存在）。

**注意**：严格模拟考试是否允许拖动/逐段播放由模考规则决定（`release_exam_phases.playback_policy`），数据支持不等于默认开放；本批样本无 phase 数据，模考播放规则未配置，不得据此开放严格模拟的逐段操作。

## 5. 需人工复核清单

1. **21 个 cue 越界 Unit**（见 §3，清单在测试 `KNOWN_OVER_DURATION` 固化）。
2. **20 个大间隔 Unit**（10–26s，确认是否为题型固有间隔）。
3. **N5 双下划线空标签**（`…ly-01-u10-q01`）：确认空 `<u style="text-decoration: underline double;">` 是否代表答案空位语义；当前丢弃无可见文本损失，若未来出现非空双下划线需扩展 RichText marks。
4. **906 个空时间模板段落**：确认均非听力字幕内容（当前判定为阅读/词汇正文模板，不进入 cues）。

## 6. 回归验证（§6）

- 五包重新转换后与基准 `Archive.zip` 逐字节比对：**内容文件 NONE changed**（Layer 83 / Unit 440 / Question 498 / Asset 204 不变，1:1 映射、选项顺序、答案映射、分组归属、媒体引用、slot 绑定全部随之不变——由字节一致性保证）。
- `provenance/*.jsonl` 5 个文件仅 `transform_version` 升为 `canonical_v2.0-converter+0.1.1`；manifest/import_report 因新增属性审计与时间戳而不同（两者均不入内容哈希）。
- **Canonical 内容哈希无任何变化**（content_hash 逐包与 staging 记录一致），staging 幂等重放不受影响。
- pytest 全量：**48 passed**（新增播放兼容 2 个测试）。
