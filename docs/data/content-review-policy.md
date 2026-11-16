# 内容审核、发布与版本追溯规范

## 审核事件顺序与可追踪 Issue（2026-11-16 起，ADR-0005）

1. **确定性顺序**：审核事件的最终有效状态按 `content_reviews.sequence`（数据库插入顺序）判定，不按 `checked_at`。同一时间的多条记录由插入顺序唯一决定结论。
2. **可追踪 Issue**：`needs_review`/`blocked`（DB CHECK 强制）、human `disputed`、验证器结构/媒体异常都落 `content_issues` 表；唯一键 `(issue_code, record_type, canonical_id, content_hash, rule_version)` 保证重复同步幂等。历史审核记录与 Issue 一律保留，不覆盖不删除。
3. **pass 不清除争议**：同一内容哈希上存在 open blocking issue 时，普通 Agent `pass` 被拦截并记 `unverified` 证据；解除阻断必须 `resolve_issue`（关联原 Issue + 当前内容哈希 + 解决证据），或由数据质量重校验在新哈希上自动 resolved。
4. **哈希绑定**：审核结论只对绑定内容哈希有效；答案状态回查按 Unit 输入哈希过滤。旧哈希结论不能覆盖新内容审核结果，也不能满足新候选版本的门槛。
5. **数据质量记录**：验证器发现的字幕时间轴异常（cue 越界/缺失/非法/大间隔）、材料分组异常等经 `app/data_quality.py` 同步入库，绑定包内容哈希与规则版本；`severity=blocking` 的未解决记录使发布门槛拒绝（warning 留痕不阻断），按 Unit/题型/严重度可查询。

6. **人工确认落地（2026-11-16）**：人工通过 `resolve_issue` 解除 Agent 标记并给出证据后，答案键不会自动变为已验证；需运行 `python -m app.review_sync apply-human <package_id>`（`apply_human_reviews`），它只把「最近一条审核是人工 `human_reviewed`、且无 open 阻断 Issue」的答案键在 **draft/in_review** release 上置为 `human_reviewed`，如实记录是人工确认，不冒充 Agent 通过；published/withdrawn 不受影响。发布门槛对 Unit 的 Agent `needs_review/blocked` 标记，在其后有人工 `human_reviewed` 的 Unit 级确认时视为已解除（open Issue 仍优先阻断）。

## 轻量化审核流程（2026-11-15 起，本地 Agent 校验优先）

1. **Agent 校验**：QA Agent 按 `agent-validation-contract.md` 逐 Unit 审核；系统通过 `app/review_sync.py` 的 `build` 生成绑定 content_hash 的审核任务，Agent 结果经 `sync` 批量同步。
2. **同步保障**：结果必须回带当前 content_hash（过期即拦截）；哈希绑定 `content_reviews` 证据行，`(record_type, canonical_id, content_hash, reviewer_type, reviewer_id)` 唯一，同批次重放幂等；与人工结论冲突、非法选项、修订冲突均拦截并留审计。
3. **状态语义**：`agent_verified` = 有有效哈希绑定校验证据的 Agent 通过；`human_reviewed` = 人工确认；两者可通过发布答案门槛。`needs_review`、`blocked`、未校验、`disputed` 不可发布。
4. **人工复核例外**：Agent 提出的不同正确选项（proposed change）、与人工结论的冲突、Unit 级 needs_review/blocked 必须人工处理；Agent 不能自行改写 Unit 转换状态。
5. **不可变性**：已发布/撤回 Release 的快照行不被 Agent 同步触碰；其校验证据仅入 `content_reviews`，作用于下一个候选版本（新 content_hash → 新 release）。
6. **独立门槛保留**：媒体完整性（verified）、Unit 完整性（conversion complete）、版权/使用许可（`publication_decisions` 中需有 `rights_confirmed` 记录）与内容校验相互独立，缺一不可发布。

以下为原有审核原则，继续有效：

## 独立的三种验证

1. **结构完整性**：实体与媒体引用、RichText、slot、题数、SHA256、转换幂等。
2. **内容质量**：题目原文、选项、正确答案、解析、翻译、音频、图片；由 Agent 提议并由必要的人审确认。
3. **发布权利**：题目、教材、图片与音频的著作权/授权/许可。自定义 schema、字段清洗和改写结构**不能替代使用权**。

## 发布状态

- `draft`：Canonical 结构输出，内容尚未完成校验。仅内部可访问。
- `review_ready`：已完成结构/资源检查，交内容校验。
- `release_candidate`：必要的内容和权利审核已通过，可申请发布。
- `published`：形成不可变 release；当前指针可切换。
- `withdrawn`：撤回公开可见性，但保留旧 Session 及历史回顾所需快照；不能物理删除已有历史。

## 审核粒度与发布闸门

- 审核内容按 `Question` 答案、解析、原文/选项与 `Unit` 共享材料/媒体分别记录，不用一个 `is_verified` 承载全部语义。
- 题目内容哈希变化后相关旧校验必须失效/待重审，不能借用原 `pass` 状态。
- 专项练习只从完整且审核允许的 Unit 中抽取；一篇共用材料不能只审两问就公开剩下一问。
- 严格模拟必须整卷依赖材料全可用，计时/播放规则得到可靠核验；仅“题目有效”不足以开模拟。
- A/B 启发式切分和语义题型未确认不得自动释放；管理端需能看原文对照和 issues。

## 发布事务和后续修订

- 候选 release 内容、答案、解析与媒体映射在同一发布事务中确认；失败必须全部回滚。
- 一旦发布，内容快照不原地 UPDATE；修订形成新 release，并保留 reviewer/依据/变更 diff。
- 回顾旧答卷时使用当时 `release_id`；如果曾有错误答案，保留原始成绩和答案版本，可建立独立 regrade 事件，不偷偷重写历史。
- 当前 release 指针与公开可见性属于可变管理状态，不能被误当作改写原始快照的授权。

## Agent 数据的信任边界

Agent 输出是**建议**不是事实本身，不能当 SQL/HTML 直接执行。校验器对任何输出重新验证枚举、ID、哈希、字段白名单，存疑记录待人工处理。对 Agent 没有实际读取的音频/图片，状态是 `not_checked` 而非自动通过。
