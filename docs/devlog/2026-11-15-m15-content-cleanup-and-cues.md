# 开发日志 · 2026-11-15 · M1.5 内容清洗审计与字幕时间轴验证

## 任务范围

M1.5 Content Cleanup & Transcript Timeline Validation：原始 HTML 属性审计、残留扫描、字幕时间轴验证、逐段播放数据兼容性、五套样本回归。**先核实既有实现，只补缺口**。

## 既有实现核实（不重复开发的部分）

以下能力在 `scripts/canonical_v2.py` / `app/importer/validator.py` 中**已存在并有验证证据**，本次未重构：

- 受限白名单 HTML 解析（p/div/br/u/b/strong/i/em + 占位符），未白名单**标签**计数上报；未知标签不静默丢失。
- `data-starttime`/`data-endtime` → 整数毫秒（`H:MM:SS[.,]mmm`），空值段落保留文本并计数。
- `<MOJiTest_URL>` 占位符不输出、不丢弃，图片挂 Question 媒体。
- cloze `（ N ）` → slot 节点绑定（bind_cloze_slots）；`★`、全角空格、标点原样保留。
- 字幕 cue 结构 `{index, start_ms, end_ms, children}` 含说话人文本。
- 验证器 cue 基本校验（index、时间合法性、重叠/倒序警告）。

## 本次改动

| 文件 | 改动 | 原因 |
|---|---|---|
| `scripts/canonical_v2.py` | ① 属性级审计：`unknown_attrs` 计数 + `style_semantics` 警告（`note_meta` 接入全部 8 个解析点），汇入 import_report `source_attr_audit`；② 版本升 `+0.1.1` | 原来未知**属性**被静默丢弃无报告（任务 §2 要求不允许）；空 `<u style="underline double">` 语义风险需上报 |
| `backend/app/importer/validator.py` | ① `cue_time_missing` / `cue_time_invalid` 拆分（缺失 vs 0 区分）；② `cue_gap_large`（>10s 间隔警告）；③ `cue_over_duration`（cue 时间界超出 verified 音频时长警告，基于 Unit 自身音频资产） | 任务 §3.6–3.10 的验证缺口 |
| `backend/tests/test_playback_compatibility.py` | 新增 2 个数据级播放兼容测试（段播放/顺序/AB 循环/全文 + 时间轴基准与 21 处越界清单固化回归） | 任务 §4，不需要正式播放器 |
| `scripts/audit_canonical_html.py` | 新增残留扫描脚本（结构化遍历 RichText/cues，非全局正则） | 任务 §5 |
| `docs/audits/2026-11-15-html-attrs-and-cue-timeline.md` | 审计报告（属性分类 A/B/C、覆盖率、异常清单、人工复核清单、回归结果） | 任务 §8.1–8.7 |

## 实际执行的测试与结果

| 命令 | 结果 |
|---|---|
| 转换器重跑（5 包）→ 与 `Archive.zip` 逐字节比对 | **内容文件 NONE changed**（计数 83/440/498/204、1:1、选项顺序、答案映射、分组、媒体、slot、确定性全部保持）；provenance 仅 `transform_version` +0.1.1；manifest/report 因新增审计而更新（不入内容哈希） |
| `pytest` 全量 | **48 passed, 0 failed** |
| `audit_canonical_html.py` 残留扫描（五包） | raw_tag/placeholder/attr_remnant/entity/cue_raw_tag/non_richtext/unknown_block **全部 0** |
| 验证器五包复检 | errors=0；warnings：`unit_conversion` 2（既有 A/B）、`cue_over_duration` 21、`cue_gap_large` 20 |
| 属性审计 | N5 `u@style`×1 + `style_semantics` 警告；`p@class` 各包计入 report |

**内容哈希零变化声明**：本次未改变任何清洗的内容输出逻辑（仅审计与验证增强），Canonical content_hash 逐包与既有 staging 记录一致——无需"更新预期值"式的掩盖。

## 补充（同日）：21 个越界 Unit 音频实测校对

用户要求直接读取音频校对。方法：SHA-256 将 21 个 Unit 的音频资产映射回 Raw `resources/` 原始文件（注意：源文件**无扩展名**，如 `2021-01-29_6013beb5502cd`、`02第一大题1.mp3`），`ffprobe` 实测容器时长后与 cue 末段逐一对比。结论：**21/21 全部真实越界，无元数据低估**；17 个为 ≤143ms 编码 padding 级（可解释），**4 个确证问题**（N4 `ly-14-u01` +186ms、`ly-15-u01` +373ms、`ly-15-u04` +980ms、`ly-15-u05` +1282ms，末段 cue 超出真实音频，疑似字幕时间源自另一次录音）保持 needs_review 待人工重对。`duration_ms` 元数据与 ffprobe 一致（±9ms）。数据与内容哈希零变化，结果已写入审计报告 §3.1。过程教训：脚本初版按扩展名过滤导致 Raw 音频查找失败——源文件无扩展名，须按内容哈希定位。

## 需人工复核（移交）

1. 21 个 cue 越界 Unit（多数为编码 padding 级，N4 ly-15 三个达 373–980ms）。
2. 20 个 10–26s 段间大间隔 Unit（疑似题型固有间隔）。
3. N5 `ly-01-u10-q01` 双下划线空标签语义。
4. 906 个空时间模板段落的归属确认（当前判定：阅读/词汇正文，非字幕）。

## 架构决策

无新增 ADR。cue 结构沿用既有 Schema（任务明示不新增重复字段）；验证增强为警告级（needs_review），不阻断导入。

## 剩余风险

- cue 越界/大间隔标记停留在 import warning 与测试回归清单，未写入 staging 库记录（重导入幂等跳过，不刷新 warning）；如需库内可见需重新全量导入。
- 严格模拟播放规则（拖动/逐段开放与否）仍未建模，不得因数据就绪而默认开放。
