# 2026-11-16 · N2：4 道被标记题的人工确认落地

## 范围
用户逐题审阅了 QA Agent 标记的 4 道题（問題7 #8、問題8 #1、問題11(1) q3、問題11(3) q1）并回复"没问题"。把人工确认如实落到 draft release，而不是让 Agent 再盖一次通过章。

## 过程与决策
1. 以审核人 `david.han`（取自 git 用户名，用户未指定）对 8 条阻断 Issue（4 答案键 + 4 Unit）执行 `resolve_issue`，证据写明：人工对照原文确认答案键正确；Agent 首轮作答有误，不声称独立。
2. 原计划让 Agent 补一轮 `pass` 转为 `agent_verified`，被安全分类器拒绝（会用 Agent 名义覆盖一次本应由人工做出的判断）；未绕过，改由用户选择"记为 human_reviewed"。
3. 实现 `apply_human_reviews`（`app/review_sync.py`，CLI：`python -m app.review_sync apply-human <package_id>`）：仅把"最近审核为人工 human_reviewed 且无 open 阻断 Issue"的答案键在 draft/in_review release 置为 `human_reviewed`；幂等；不动已验证键与 published release。
4. `promote_release` 的 Unit 标记检查：Unit 最近一条审核若是人工 `human_reviewed`，视为已解除 Agent 的 needs_review（open Issue 仍优先阻断）。
5. 文档：`content-review-policy.md` 增第 6 条。

## 测试（真实 PG，隔离测试库）
- 新增 3 个：未解除 Issue 时不应用；解除后需 apply 才变 `human_reviewed`（仅解除不改键、promote 仍拒绝；apply 后幂等、不动其他键、promote 成功）；published release 不被改动。先写后见失败再实现。
- 后端全量：106 passed, 2 skipped（skip 为缺本地 Canonical Archive.zip，环境性）。

## 开发库 N2 当前状态（只读核对）
- 答案键：`agent_verified` 69 + `human_reviewed` 4 + `unverified` 30（全部为听力）。
- 开放阻断 Issue：0。release 仍为 `draft`，`exam_current_releases` 0 行，未发布。

## 未完成 / 风险
- 听力 30 题无人校验（需有人听音频）；`rights_confirmed` 未记录（版权决定在用户）。
- 审核人 ID `david.han` 是我按 git 用户名假定的，用户若要另一个 ID 需更正记录。
- 本次未对真实 N2 执行 promote 门槛试探（该函数条件满足时会发布，被拒绝过一次），门槛逻辑由单元测试覆盖。
- 前端未改动，未重跑前端测试。
