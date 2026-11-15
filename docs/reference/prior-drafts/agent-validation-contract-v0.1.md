# JLPT GO 2.0｜题库校验 Agent 数据交接规范 v0.1

> 日期：2026-11-15  
> 状态：**设计建议 / 待评审，尚未执行**  
> 关联文档：`JLPT_GO_2.0_PRD_v0.1.md`、`JLPT_GO_2.0_Database_Design_v0.1.md`  
> 样本来源：上传的 `exams.json`、`questions.json`、`assets.json`（32 套 N2，3,334 题，1,147 条资源记录）  
> 项目边界：JLPT GO 1.0 继续运行；校验 Agent 和 JLPT GO 2.0 独立运行；**不允许 Agent 直接修改旧版数据库或新版正式发布库**。

## 1. 目标和非目标

**目标**：允许 N5–N1 数量庞大的题库按试卷 / Unit 分批校验、暂停、重试；输出稳定的机器可读结果；能够识别答案、题干、选项、解析、翻译与媒体的不同问题；确保修订有证据、可审计、可撤销；2.0 可在校验进行期间独立开发。

**非目标**：不要求本轮把全部题目人工复核；不让 Agent 代替发布决策；不自动认定源题、教材、图片、音频具有发布授权；不在验证过程中重写历史用户成绩；不强行用单一“准确率分数”判断某道题可靠。

## 2. 双方职责与权限

| 组件 | 有权执行 | 禁止执行 |
|---|---|---|
| 原始数据存储 | 保存只读 JSON、资源校验值 | 覆盖唯一原始文件 |
| 校验 Agent | 读取题目及关联材料、独立作答、判断问题、建议修改、输出 JSONL | 连接/更新正式 DB，直接修改原始 JSON，擅自决定公开发布 |
| 校验结果导入器 | Schema 验证、字段白名单、哈希检查、幂等去重、写入候选版本 | 将 Agent 文本当 SQL / HTML 直接执行；忽视源版本冲突 |
| 人工/规则审核 | 处理歧义、高风险修订、发布门槛与抽样 QA | 无依据地批量覆盖存疑数据 |
| 题库后台 | 管理候选内容、发布版本、可追溯审计 | 删除既有正式作答证据 |

## 3. 输入：保持源格式，附加规范化上下文

现有文件提供：

- `exams.json`：`exam_id`, `level`, `session`, `title`, `date`, `layers`；层级含 `layer_id`, `questionType`, `title`, `question_count` 等。
- `questions.json`：`exam_id`, `layer_id`, `question_id`, `parent_id`, `question_type`, `title`, `passage`, `options`, `right_answer`, `analysis`, `translation`, `subtitle`, `media_id`, `media_path`, `image_id`, `image_path`, `created_at`, `updated_at` 等。
- `assets.json`：`exam_id`, `source_id`, `source_path`, `target_path`, `size`, `content_type`, `field` 等。

**关键约束**：源 `right_answer` 是字符串形式的 **0 基选项索引**（例如 `"0"` 表示第一个选项），不是数据库 `option_id`，也不是 1–4 的印刷序号。当前 N2 样本有 3 选项与 4 选项题，不能硬编码 4 个选项。

输入任务建议由**任务生成器**封装，而非让 Agent 自行拼接全库 JSON：

```json
{
  "contract_version": "1.0",
  "job_id": "verify-N2-201812-q001",
  "source_dataset": "n2-raw-20261115",
  "source_sha256": "<SHA256 OF CANONICAL SOURCE RECORD>",
  "exam": {"exam_id": "N2-201812", "level": "N2", "session": "2018-12"},
  "layer": {"layer_id": "N2-201812:201812N2010101001-005*01", "question_type": 11, "title": "<原始大题说明>"},
  "unit": {"source_group_key": "<经转换器识别的材料组标识>", "context_confidence": "confirmed"},
  "question": {
    "question_id": "N2-201812:201812N2010101001*01",
    "question_type": 11,
    "title": "二人は<u>離れて</u>座った。",
    "options": ["はなれて", "わかれて", "かくれて", "はずれて"],
    "right_answer": "0",
    "analysis": "<原始解析>",
    "translation": "",
    "passage": "",
    "subtitle": ""
  },
  "unit_siblings": [],
  "assets": []
}
```

`unit_siblings` 用于共享文章、句子排列材料、共用音频或图片的关联题目，避免只看孤立题导致误判。**Agent 不应自行认定 `parent_id` 相同就必定是同一 Unit。** 若转换器对分组无法确认，任务标记 `context_confidence="unresolved"`，结果不得自动放行。

真实资源校验应传递可读取的文件或经过核实的资源引用；仅有 `assets.json` 元数据时，只能检查路径和声明，**不能宣称音频可听、图片清晰或字幕准确**。

## 4. 输出格式：一题一行 JSONL

建议每份任务输出一条 `question_review.jsonl` 记录，可并行处理、增量合并、按 ID 重试：

```json
{
  "contract_version": "1.0",
  "job_id": "verify-N2-201812-q001",
  "question_id": "N2-201812:201812N2010101001*01",
  "source_sha256": "<SAME HASH AS INPUT>",
  "review_run_id": "run-20261115-001",
  "agent": {"provider": "<model-provider>", "model": "<model-id>", "prompt_version": "qa-v1"},
  "checked_at": "2026-11-15T03:00:00Z",
  "overall_status": "pass",
  "checks": {
    "stem_options": "pass",
    "answer": "pass",
    "analysis": "pass",
    "translation": "not_applicable",
    "material": "not_applicable",
    "media": "not_checked"
  },
  "independent_answer_index": 0,
  "source_answer_index": 0,
  "answer_agrees_with_source": true,
  "reasoning_summary": "‘離れて’ 的读音是 はなれて；其余选项不符。",
  "evidence": [{"kind": "linguistic_reasoning", "reference": null, "note": "读音与语境一致"}],
  "confidence": "high",
  "proposed_changes": [],
  "issues": []
}
```

### 4.1 字段语义

| 字段 | 规则 |
|---|---|
| `contract_version` | 协议版本；与内容发布版本不是一回事 |
| `job_id` | 一个确定校验任务的稳定标识；用于重试去重 |
| `question_id` | 原始稳定题目源 ID；新版数据库 ID 不由 Agent 生成 |
| `source_sha256` | 绑定当前校验依据，防止旧结论覆盖新内容 |
| `review_run_id` | 一次 Agent 校验运行，允许同题不同次审核并存 |
| `checks` | 按字段维度提供结论，不能只输出一个总布尔值 |
| `independent_answer_index` | Agent 尝试独立作答的 0 基答案；无法判断时为 `null` |
| `source_answer_index` | 源数据 0 基答案索引，不得擅自解释为选项 ID |
| `reasoning_summary` | 简短可审查的判断依据，而非冗长的内部推理 |
| `evidence` | 支持判断的文本理由或可核实来源；禁止编造引用 |
| `proposed_changes` | 修订建议，导入器只能接受白名单字段 |
| `issues` | 需要人工/规则处理的异常及影响程度 |

### 4.2 状态枚举（建议）

逐项 `checks.*`：

- `pass`：在现有可用证据范围内未发现问题；**不意味着官方认证**。
- `change_proposed`：提出具体修订，但尚未经正式接受。
- `needs_review`：证据不足、存在歧义或与其他题冲突。
- `blocked`：缺失关键材料、无合法候选答案、结构损坏等，不能直接用于发布。
- `not_checked`：本轮未核验（例如缺少真实音频文件）。
- `not_applicable`：该项本来不存在，如无翻译。

`overall_status`：`pass | change_proposed | needs_review | blocked`；由已核验维度和风险规则汇总，**不能用 `pass` 淹没某一项的 `blocked` 或 `needs_review`**。

`confidence`：`high | medium | low`，仅描述模型判断信心，不替代通过标准；同题两次不同模型均给 `high` 也不构成自动官方验证。

**与数据库发布状态分离**：Agent 不输出 `published`、`publish_ready`；发布与权利审核由 2.0 后台负责。

## 5. 修订建议：只输出 Patch，不直接改原题

修订采用字段级白名单（建议初期）：

`question.title`、`question.options[0..n-1]`、`question.right_answer`、`question.analysis`、`question.translation`、`question.passage`、`question.subtitle`。

针对共用文章/音频组，不允许 Agent 在多道题记录中重复任意改写全文；应输出到单独的 `unit_review.jsonl`，由 Unit 级审核一次后统一应用。媒体文件修改不接受自由文本路径 Patch，必须由专门资源验证/上传流程处理。

建议 Patch 结构：

```json
{
  "field": "question.right_answer",
  "old_value": "0",
  "proposed_value": "1",
  "change_type": "answer_correction",
  "reason": "<明确的校验依据>",
  "requires_human_review": true
}
```

> 上述索引变更仅是格式示例，**不代表样本题真的需要改答案**。导入器需根据同题 `options` 长度验证索引范围，并复核所选答案内容。

每次正式接受 Patch 形成**候选内容版本**；只有发布流程才将其变成当前可用版本。原始版本永远可以追溯。

## 6. 存疑题和高风险分流

建议按照风险分流，避免人工审核变成全题库瓶颈：

| 风险 | 示例 | 建议处理 |
|---|---|---|
| 低 | 独立检查结论与源答案一致，选项合法，材料完整 | 进入批次抽样 QA；满足发布政策后可批量通过内容审核 |
| 中 | 解析有歧义、翻译不准确、少量格式问题 | 输出修订建议；二次 Agent 核验或抽样人工复核 |
| 高 | 正确答案改动、存在多个合理答案、文章/音频缺失、题型归属冲突、跨题组材料不一致 | **强制隔离，人工决策或有独立证据的复核，不自动发布** |
| 权利待确认 | 来源条款、题目/音频/教材版权不明 | 内容技术校验可以继续，但**不得因为校验通过就自动公开发布** |

**避免自我确认**：对答案核验，优先让 Agent 在不知道源正确选项的条件下先独立求解，然后比较原 `right_answer`；能做到时采用不同模型或不同提示进行争议复核。无法提供可靠独立证据时，以 `needs_review` 标记，不强制填入正确答案。

## 7. Unit 级输出（关键）

`unit_review.jsonl` 用来处理题组边界及共享材料：

```json
{
  "contract_version": "1.0",
  "exam_id": "N2-201812",
  "layer_id": "<SOURCE LAYER ID>",
  "source_group_key": "<CANONICAL GROUP KEY>",
  "question_ids": ["<SOURCE QUESTION ID A>", "<SOURCE QUESTION ID B>"],
  "grouping_status": "pass",
  "material_checks": {"passage": "pass", "audio": "not_applicable", "image": "not_applicable"},
  "shared_material_changes": [],
  "issues": []
}
```

`grouping_status` 可为 `pass | needs_review | blocked`。不允许 Agent 直接根据任意字符串推断 Unit，或把共享原文随每道 Question 独立发布多份。N2 样本中独立词汇题虽然 `parent_id` 可能统一指向 Layer，但**每题仍各自一个 Unit**。

## 8. 批次目录及进度追踪

建议按试卷作为主要可恢复批次，并以 Unit 作为上下文任务单位、Question 作为校验结果单位。

```text
review-workspace/
  raw/                         # 不可变原始来源（只读）
  jobs/N2-201812/              # 本轮任务输入
  runs/2026-11-15-run001/
    manifest.json               # 本轮范围与算法版本
    question_review.jsonl       # 逐题结果
    unit_review.jsonl           # 逐组结果
    errors.jsonl                # 执行/解析异常，不等于题目错误
  reports/
    N2-201812-summary.json     # 覆盖率、待审、冲突、资源缺失
```

`manifest.json` 建议包含：`batch_id`、`dataset_id`、原始文件 SHA256、协议版本、任务生成器版本、Agent 配置、计划题数、完成数、失败数、未处理数、开始完成时间和重试计数。**校验覆盖率**分母应为计划校验题目数，不能把 `not_checked` 和 `needs_review` 当作已通过。

单题结果采用 `question_id + source_sha256 + review_run_id` 唯一标识，重试可以保留不同次结论；同一次运行重复写入需幂等。跨批次同题结果冲突时生成争议记录，不采用“后写覆盖前写”。

推荐最小报告：

- 计划、已处理、处理失败、未处理、通过、建议修订、待复核、阻断数量。
- 答案不一致数、共享材料冲突数、无效选项索引数、音频/图片不可验证数。
- 按 N5–N1、年份、题型拆分统计；每批输出可复现的异常清单。
- 发布就绪率与 Agent 校验完成率分开报表。

## 9. 新版导入和发布流程

1. **只读接收**：核对源 ID、SHA256、任务协议版本和结果格式。
2. **纯结构验证**：枚举值、字段类型、选项索引、必须字段、关联 Unit、记录顺序、资源引用一致性。
3. **安全过滤**：Patch 白名单、富文本净化、避免将自由文本当作 SQL/路径/命令执行。
4. **冲突与风险分流**：哈希不匹配或多 Agent 结论冲突时不得静默覆盖；答案修订需高风险审批。
5. **候选版本生成**：将确认的修订写入隔离的内容候选版本，并保留来源记录和前后值。
6. **内容发布门禁**：核心题干、选项、正确答案、所属 Unit、必要共享材料检查通过；媒体可用性、版权/授权单独验证。**严格完整模拟须整卷满足要求**，专项仅抽取已满足要求的完整 Unit。
7. **发布版本引用**：作答会话绑定当时的已发布内容/答案版本；未来修正不能静默改动历史成绩。

## 10. 与 2.0 的接口边界（初步）

- Agent 与 2.0 的第一版交接建议采用 **文件协议 JSONL + manifest**，无需远程实时调用；利于几周长任务的断点续跑、失败重试和回溯。
- 2.0 导入器消费经过格式验证的结果并产出 `import_report.json`（成功、拒绝、冲突、原因）。
- 后续如需更频繁接入，可增加后台 API，但其有效载荷与验证规则仍使用同一协议，不要让 Agent 直接执行业务表 UPDATE。
- 大规模数据和媒体文件本身存储独立，JSONL 只包含结构化引用，不内嵌音频二进制或图片 base64。
- 旧项目数据库不参与该过程，不因 2.0 研发运行批处理或迁移脚本。

## 11. 必须先验证的真实样本

- `N2-201812` 的词汇问题 1：独立单题，`right_answer="0"` 是第一选项。
- 文法问题 9：共用一篇文章的多个填空题；不能只看单题解析。
- 读解问题 11：三篇文章，按不同 `parent_id` 划分完整 Unit。
- 读解问题 14：大题级图片引用，问题自身可能无 `image_path`。
- 听力问题 5：独立音频与两问题共用音频并存，需要校验资源可访问性和同步字幕。
- 选项数：N2 样本中存在 3 选项与 4 选项题；必须按长度验证。
- `question_type` 不一致：异常清单不能静默修复。

## 12. 待确认的设计选择

1. **答案改动审核政策**：是否全部人工核验，或允许“独立证据充分 + 双模型一致 + 抽检”作为分批审核路径？当前建议正确答案改变必须人工或有明确独立证据审批，默认不自动发布。
2. **解析和翻译的发布门槛**：是否允许答案可信、解析待完善的题目用于普通练习？建议根据产品模式分层，而不是把无解析误认为题目不可用。
3. **校验环境**：Agent 能否实际访问音频与图片文件？不能时 `media=not_checked`。
4. **Agent 输出正文类型**：先保留受控 HTML + 原文，或立即采用结构化富文本；建议与数据库 Unit/解析模型同步决定。
5. **人工抽样比例**：应根据最初几个批次的错误率、答案不一致率和风险分布制定，不宜凭空定百分比。

---

**文档性质：协议设计草案，非可直接运行的导入器，也不是实际 Agent 校验结果。** 当前未执行任何 Agent 校验、数据库迁移、题库发布或旧版项目修改。
