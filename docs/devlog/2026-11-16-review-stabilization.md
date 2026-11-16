# 开发日志 · 2026-11-16 · M1.6 内容审核与数据校验稳定化

## 任务范围

审核记录机制（确定性顺序、可追踪 Issue、pass 不清争议、哈希绑定）+ 字幕/材料异常同步（数据质量记录）+ Alembic 0003 + 测试与验收。不做前端，不跑全量 N5–N1 校验，不发布内容。

## 改动内容

| 项 | 实现 |
|---|---|
| Alembic 0003 | `0003_review_sequence_issues`：新表 `content_issues`（source/issue_code/record_type/canonical_id/content_hash/severity/rule_version/status/detail + 解决字段，唯一去重键 `uq_content_issue_identity`，部分索引 open）；`content_reviews` 加 `sequence` identity（DB 级插入顺序）、`issue_id` FK、CHECK `ck_cr_blocking_has_issue`（needs_review/blocked 必须关联 Issue）。纯增量，已在真实 PG 验证 upgrade→downgrade→upgrade，数据零丢失 |
| 状态解析 | 新 `app/review_state.py`：`latest_review`（按 sequence）、`open_issues`、`effective_status`（open blocking issue 恒压过后续 pass）、`raise_issue`（幂等 upsert）、`resolve_issue`（显式解除：原 Issue + 当前哈希 + 证据，拒绝重复解除） |
| review_sync | Unit/Question 阻断结论自动建 Issue 并回链 `issue_id`；proposed_change 升级为 blocking Issue；pass 前检查 open issue（拦截 `open_issue`）与 human `disputed`（改按 sequence 取最新）；所有排序从 `checked_at` 换成 `sequence` |
| publisher | 发布答案状态回查：按**本题所属 Unit 输入哈希**过滤 + sequence 取最新（旧哈希结论不再流入新候选版本）；promote Unit 门槛改 sequence + open issue；**新增门槛**：当前内容哈希上存在 open blocking 记录（含数据质量异常）拒绝发布 |
| 数据质量同步 | 新 `app/data_quality.py`：`sync`（验证器 warning → `content_issues`，绑定包内容哈希 + `dq-rules-1.0.0`，ON CONFLICT 幂等；warning=不阻断/blocking=发布门槛拒绝；重校验后旧发现自动 resolved 并绑定新哈希与证据）、`query`（按 Unit/题型/severity/code）、CLI `python -m app.data_quality sync/query` |
| 验证器 | `material_grouping` 新警告：有 cue 无配对 Unit 音频、或一 Unit 多音频锚定歧义；`audio_asset_ids` 计算提前复用 |
| 测试 | 新增 7 个（同秒多记录确定性、pass 不清 open issue、复核解除指定问题、旧哈希不覆盖新结果、DQ 幂等+查询、blocking 记录拒发布+重校验解除、Issue 历史保留）；conftest 清理补 `content_issues` 与 as002；**55 passed**（原 48 全部保持通过） |
| 文档 | ADR-0005 + decisions/README P-015；content-review-policy.md 新「审核事件顺序与可追踪 Issue」节；本日志 + progress.md |

## 实际执行的测试与结果

- pytest 全量 ×2：**55 passed, 0 failed**（隔离测试库 `<db>_test`，真实开发库零接触；测试后核查真实库 jobs=5 / reviews=0 / issues=0 / releases=1 未变）。
- 迁移 0003 真实 PG：upgrade → downgrade → upgrade 全通过；import_jobs/content_reviews 数据前后一致。
- **N4 验收（真实开发库，非全量）**：`python -m app.data_quality sync JLPTGO-N4-2018-07-r1` → 20 条（12 blocking `cue_over_duration`、7 warning `cue_gap_large`、1 warning `provenance_missing`）；重复 sync 幂等（created 0 / reseen 20）。**4 个确证问题可查询且越界幅度与 ffprobe 审计吻合**：`ly-14-u01` +186ms、`ly-15-u01` +373ms、`ly-15-u04` +980ms、`ly-15-u05` +1283ms，全部 open blocking。这些记录将阻止 N4 内容哈希发布，直至人工解除或内容修订。
- 未执行：ruff/mypy（仍未配置）；N5/N3/N2/N1 的 DQ 同步（按任务要求不自动全量跑，后续逐包执行即可）。

## 新增或修复的风险说明

- **修复**：同秒审核记录顺序不定；普通 pass 可静默清除更早 needs_review/disputed；发布答案状态回查不过滤哈希（旧结论跨版本泄漏）——三个发布门槛漏洞全部闭合。
- **行为变化**：`not_checked`/`proposed_change` 等非 pass 结论现在会建 blocking Issue 并阻止相关内容发布（此前仅留证据）——更保守，符合「存疑不可发布」。
- **风险**：`sequence` 在并发插入时按分配序入库，极端并发下「后提交先入库」仍可能；当前同步均为单进程 CLI，可接受。真实五包的 asset_unverified/provenance_missing 也会作为 warning 记录，量大但属既知状态。
- **未解决**：发布快照仍无 DB 级不可变触发器（P-013 既有缺口）；N4 4 个确证问题待人工重对时间轴。

## 架构决策

新增 **ADR-0005**（审核事件顺序 + content_issues + DQ 记录），Alembic 0003 落地；其余为既有 ADR-0004/轻量化政策的加固实现。
