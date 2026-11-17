# ADR-0014 Quick Practice 轻量化：独立会话模式、无草稿、提交即完成

状态：已接受（用户 2026-11-17 指示：Quick Practice 移除草稿、恢复和会话管理流程，实现随点随练；
试卷目录显示「未练习 / 已练习 N 次」与 Layer「已练习 X / Y 组」；不删除 `study_answer_drafts` 表）。其中「专项练习单活跃约束不变」一句已被 ADR-0015 取代。

## 背景

quick-practice.md v1.0（2026-11-17）把历年试卷单 Unit 练习做成了「点击直达」，但会话模型仍复用
专项练习的 `mode='practice'` 单活跃约束：已有进行中练习时必须弹「继续旧练习？」三操作对话框，
并经 `replace_active=true` 原子结束旧会话；答题页还带服务端草稿自动保存与刷新恢复。这与
「随点随练」目标冲突：单 Unit 练习不需要跨刷新恢复，也不应该打扰进行中的专项练习。

## 决策

1. **新增独立会话模式 `quick_practice`**（`study_sessions.mode`，Alembic 0009）：
   - 扩展 mode CHECK 与 mode/`mock_release_id` 一致性 CHECK（quick 会话 `mock_release_id IS NULL`）。
   - 新增部分唯一索引 `ux_one_active_quick`（每用户至多一个进行中 quick 会话）。
   - 专项练习（`ux_one_active_practice`）与严格模考（`ux_one_active_mock`）的约束**不变**；
     Quick Practice 不占专项名额、不结束专项会话，反之亦然。
2. **创建即入、静默替换**：`POST /api/quick-practice/sessions`（单 Unit、固定 immediate）在
   同一事务内把旧的进行中 **quick** 会话置 `ended_early` 并建新会话——无「继续旧练习？」弹窗。
   被替换的 quick 会话至多只有未提交的本地选择（见第 3 条），替换无损失。并发双击由
   `ux_one_active_quick` 兜底（后者 409，前端重试一次，赢家同样是新会话）。
3. **无服务端草稿**：Quick Practice 的未提交选择只存在于当前 React 页面状态；不调用
   `PUT /drafts`，刷新/离开即重置。`study_answer_drafts` 表与其机制保留给专项练习。
4. **提交即完成**：quick 会话只有一个 Unit；正式提交的同一事务内自动完成会话
   （`state='completed'` + `study_results` 聚合成绩），不留长期进行中的会话。
   判题、整组提交原子性、幂等与答案权限门控**完全复用**现有机制（含 feedback/transcript gate）。
5. **真实练习历史计数**：`GET /api/exams/{id}/practice-status` 统计两种 practice 模式的已提交
   session-unit（一个 session-unit = 一次练习；幂等重复提交复用同一行，不会重复计数；
   多 Question Unit 只计一次）。目录「未练习 / 已练习 N 次」与 Layer「已练习 X / Y 组」由该
   接口驱动，前端不得自行累加。
6. **提交后导航**：就地反馈（不强制独立成绩页）；「下一组」= 同一试卷按 Layer/Unit position
   的下一个 Unit 开新 quick 会话；已练习 Unit 再进入一律开始新练习，历史作答不可变。

## 取舍

- **模式隔离 vs 共用单活跃约束**：隔离是唯一同时满足「不弹冲突窗」「不结束专项练习」的方案；
  在前端隐藏弹窗只会把 409 变成死路（用户明确禁止）。新增 mode 值是一次性小迁移，后续
  quick 专属行为（如统计口径）也有了干净的挂靠点。
- **静默结束旧 quick 会话 vs 允许多个进行中**：单活跃 + 静默替换与「不创建无意义的长期
  进行中会话」一致；由于 quick 无服务端草稿，被替换者没有任何可恢复的数据，无需征询。
- **quick 不写草稿但保留 drafts 端点对 quick 会话的可用性**：端点通用机制不动，只是前端
  流程不再使用；避免为「简化」删除会被专项练习复用的服务端逻辑。
- **计数包含专项练习的提交**：两种模式都是该 Unit 的真实正式练习；用户要求按真实作答历史计算。
- 旧 quick 会话被替换后，其页面显示「已被新的练习取代」并提供重新入口，而非报错。

## 影响

- `backend/alembic/versions/0009_quick_practice_mode.py`（CHECK × 2 + 部分唯一索引）。
- `backend/app/api/practice.py`：quick 创建端点、`_require_active_practice` 接受两种 practice 模式、
  提交自动完成（抽出的 `_complete_session` 与 finish 共用）、practice-status 双模式统计。
- `apps/web`：目录页无冲突弹窗直入、练习次数/Layer 进度展示；答题页 quick 分支
  （本地选择、无自动保存/恢复、提交即完成、下一组开新会话）。
- 规范：`docs/design/quick-practice.md` v2.0 全量替换 §3/§4/§5/§8。
