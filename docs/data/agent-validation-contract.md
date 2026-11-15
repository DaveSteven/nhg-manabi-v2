# 题库校验 Agent ↔ JLPT GO 2.0 · 数据协议最新版

> 由此前 `reference/prior-drafts/agent-validation-contract-v0.1.md` 修订。旧稿基于扁平化 `questions.json`；现在 Agent **应该接收 Canonical v2.0 题目及完整 Unit 上下文**。文件字段以 Canonical 正式 schema 为准，不允许继续让 Agent 以源 objectId 作为正式 question_id。

## 职责与权限

- ETL/Importer：从原始只读包清洗结构并生成 Canonical Draft；保证层级、选项、媒体、锚点不丢失，**不判断语言学答案正确**。
- QA Agent：读取 Unit、关联 Question/Options、材料、字幕与审核历史，独立校验并提出修订建议；不写正式数据库、不修改原始包、不批准发布。
- 审核工作台：复核存疑和关键修改，写入候选版本及审计记录；对外发布另有版权/合法性许可门槛。

## 输入任务建议格式

```json
{
  "contract_version": "2.0",
  "job_id": "review-JLPTGO-N2-2018-12-u001",
  "package_id": "JLPTGO-N2-2018-12-r1",
  "schema_version": "2.0.0",
  "content_hash": "<hash-of-current-canonical-unit-and-related-keys>",
  "exam_id": "JLPTGO-N2-2018-12",
  "unit_id": "<stable-jlptgo-canonical-unit-id>",
  "unit": {"kind": "cloze", "materials": [], "slot_ids": []},
  "questions": [{"id": "<canonical-question-id>", "prompt": null, "options": []}],
  "answer_keys_private": [{"question_id": "<id>", "correct_option_id": "<id>"}],
  "provenance_ref": "<internal-source-mapping-key>",
  "media_review_refs": []
}
```

以上为**概念示例而不是可直接通过 schema 校验的数据包**，`materials`/`questions` 的具体内部字段请按 Canonical v2.0 实体定义序列化。`answer_keys_private` 只发送给受信 Agent 工具，不进入学生端。分享原始媒体应使用带权限的访问方式。

## 输出：一条 Unit 审核结果 + 逐 Question 检查

```json
{
  "contract_version": "2.0",
  "job_id": "review-JLPTGO-N2-2018-12-u001",
  "unit_id": "<stable-unit-id>",
  "content_hash": "<same-input-hash>",
  "review_run_id": "<run-id>",
  "agent": {"model": "<model-id>", "prompt_version": "qa-v2"},
  "status": "needs_review",
  "checks": {
    "material": "pass", "media": "not_checked", "structure": "pass"
  },
  "questions": [
    {"question_id": "<canonical-question-id>",
     "stem_options": "pass", "answer": "needs_review", "analysis": "not_checked",
     "independent_answer_option_id": null, "suggestions": []}
  ],
  "issues": [],
  "checked_at": "2026-11-15T00:00:00Z"
}
```

枚举建议 `pass / proposed_change / needs_review / blocked / not_checked / not_applicable`。Agent 必须能够承认未知，不能在音频未实际听过的情况下给出 `media=pass`。

## 验收规则

- 每个结果必须带当前 `content_hash`；内容变更后旧结果不能直接覆盖新内容。
- 保存独立判断、依据摘要、置信区间或不确定性、修订建议、模型/Prompt 版本、时间和运行 ID；敏感推理全文不是必需交付。
- 多题 Unit 使用同一共享材料上下文整体分析，避免只校一题就推断同组其他题。
- `source right_answer` 的 0 基索引仅在 ETL/内部对照阶段使用；Agent 对 Canonical 使用 `correct_option_id`，不反向恢复源 index 作为业务 ID。
- 逐 Question 校验结果与 Unit 材料校验结果相互独立，材料错误可阻止整组发布。
- 修订写 staging 候选版本，记录原值、建议值和影响范围；无管理员确认/发布门槛时不写 published Release。

## 批次/恢复

按试卷或 Unit 创建确定性 job ID，结果 JSONL 可逐行写入、按 `(job_id,review_run_id)` 去重、失败重试。不同模型重新审核允许保留多次结果，不自动取“最后一次”覆盖所有判断。先在五套已验证结构包上试运行协议，逐步覆盖 N5–N1。
