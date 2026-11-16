# ADR-0005：审核事件确定性顺序与可追踪 Issue

- 状态：已采用（M1.6 落地，Alembic 0003）
- 日期：2026-11-16

## 决定

1. **审核事件的最终有效状态以数据库插入顺序（`content_reviews.sequence` identity 列）为准**，`checked_at` 仅作展示。同一秒的多条记录、乱序时钟都不再影响结论。
2. **阻断性结论必须落到可追踪 Issue**：`needs_review`/`blocked` 的审核记录必须关联 `content_issues` 行（DB CHECK 强制）；human `disputed` 与验证器发现同样入 `content_issues`，以 `(issue_code, record_type, canonical_id, content_hash, rule_version)` 幂等去重。
3. **普通 Agent `pass` 永不自动清除未解决的争议**：同一内容哈希上存在 open blocking issue 时，pass 被拦截为 `unverified` 证据；解除阻断是显式动作（`resolve_issue`：关联原 Issue + 当前内容哈希 + 解决证据），或由数据质量重校验在新哈希上自动标记 resolved。
4. **审核结论严格绑定内容哈希**：答案状态回查按 Unit 输入哈希过滤并按 sequence 取最新；旧哈希的结论既不能覆盖新内容，也不能满足新候选版本的发布门槛。
5. **结构与媒体异常（字幕时间轴、材料分组等）作为独立数据质量记录**入 `content_issues`，绑定 Canonical 包内容哈希与规则版本；severity=blocking 的未解决记录使发布门槛拒绝（warning 仅留痕不阻断）。原始音频/字幕与已发布 Release 不被修改。

## 理由

此前「最新判定按 checked_at 排序」在同秒批次下顺序不确定，且最新 `pass` 会覆盖更早的 `needs_review`/`disputed`，发布答案状态回查不过滤哈希——三者叠加意味着争议可能被静默清除、旧结论可能流入新内容。Issue 实体使「哪些问题仍未解决、依据什么解除」成为可查询的事实，而不是散落在证据 JSON 里。

## 影响

- `app/review_state.py`、`app/data_quality.py` 为状态解析与 DQ 同步的唯一入口；`review_sync`/`publisher` 的阻断判断一律走 sequence + open issue。
- 未解决 blocking 记录（如 N4 四个确证字幕越界）会阻止对应内容哈希发布，直到人工解除或内容修订后重校验。
- 更改本决策须同步 `docs/data/content-review-policy.md`、迁移 0003 与相关测试。
