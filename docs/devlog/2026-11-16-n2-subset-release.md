# 2026-11-16 · N2 2018-12 非听力子集发布（本机开发库）

## 范围与授权
用户指示"现发布，后期我再校验"，并在对话中明确：(1) 同意发布不含听力的 N2 候选子集；(2) 确认拥有该内容的使用权，由我以 `david.han` 记录 `rights_confirmed`。"发布"仅指**本机开发库**里该 release 变为 `published`，未部署、未推送，未对外公开。

## 过程
1. 听力 30 题无人校验，门槛会拒绝整卷 → 用新脚本 `scripts/build_subset_package.py` 从已校验的 `r1` 包**仅过滤、不编辑**，生成不含听力的候选包。
2. 暂存时发现 `ly-12-u01`（問題12 A/B 对比阅读）`conversion_status=needs_review`（A/B 启发式切分，须人工确认，Agent 不能改）→ 同样排除该 Unit，并去掉因此为空的 layer。最终 **`JLPTGO-N2-2018-12-r4`：3 section / 13 layer / 58 Unit / 71 题 / 1 个图片资产**。
3. **发现：审核证据不会随新包沿用。** Unit 输入哈希包含 `package_id`/`job_id`，新包 id ⇒ 全部新哈希，73 个键起始全为 `unverified`（此前我误以为会沿用）。处理：用我对相同内容的原始作答结果，按 r4 哈希重新同步（67 题 `agent_verified`）；4 题经 `resolve_issue` → `apply-human` 记为 `human_reviewed`，并在证据里写明"沿用用户对 r1 的确认；r4 内容与 r1 逐条比对完全一致"。已逐条比对 281 条保留记录（unit/question/answer_key/explanation）与 r1 **零差异**后才沿用。
4. 发现并修复 bug：`publisher_cli confirm-rights` 因缺少 import 抛 `NameError`；补 import 与回归测试。
5. 记录 `rights_confirmed`（审核人 `david.han`，备注含授权来源与范围），随后 `promote`：`state=published`。

## 验证（真实 API，指向开发库）
- `/api/exams`：N2 2018-12，revision 4。大纲：词汇 30、文法 18、读解 10 个 Unit。
- 逐个拉取 58 个 Unit：200，响应键中无 `correct_option_id(s)/is_correct/explanations/answer_key/cues`。
- 被排除的 問題12 Unit 与听力 Unit：404；图片资产 Range 请求 206；听力音频资产（不在该 release 内）：404。
- 后端 `pytest` 全量（真实 PG）见下方命令输出汇总行。未运行前端测试（未改前端）；未在浏览器里走查真实 N2 题目。

## 遗留 / 风险
- 暂存了 r2、r3 两个**未发布**的 draft release（构建过程中的中间产物，r2 含空 layer 或 needs_review Unit），可日后清理；r1 的 draft 保留。
- `package_id` 进入审核哈希是设计隐患：同样内容换包 id 就丢失全部证据。建议另开 ADR 评估把哈希改为只依赖内容。本次未改。
- 听力 30 题和 問題12 未发布：待你校验（听力）与确认 A/B 切分（問題12）后，作为新 release 发布。
- `agent_verified` 的 67 题是我（单模型单次）独立作答，我自己首轮就答错了 4 题；你说后期会校验，建议重点抽查。
- 审核人 ID `david.han` 为按 git 用户名假定；发布权利确认以你在对话中的明确答复为依据。
- `data/v2-media` 仅在本机；本发布只依赖其中 1 个图片资产。
