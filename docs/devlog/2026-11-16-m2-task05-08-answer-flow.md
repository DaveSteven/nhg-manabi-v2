# 开发日志 · 2026-11-16 · M2 Task 05–08（草稿、提交、反馈、结果）

## 范围

M2.1 后四项：答案草稿管理（05）、Unit 正式提交（06）、反馈权限控制（07）、练习结果（08）。全部落在 `backend/app/api/practice.py`（同一模块，共享会话/单元加载与权限辅助函数）。无 Schema 变更、无迁移——五张 `study_*` 表在 Schema v0.2 已含全部所需约束。

## 改动内容

**Task 05 · 草稿管理**
- `PUT .../units/{suid}/drafts`：单题草稿保存/修改/清除（`chosen_option_id=null`），`row_version` 乐观锁——`expected_row_version` 不匹配返回 409 并携带 `current_row_version`，旧请求不可能覆盖新数据；新草稿要求 expected=0。
- 校验：题目必须属于该 Unit（release+unit 绑定）、选项必须属于该题，否则 422（`question_not_in_unit` / `invalid_option`）。
- `GET .../{sid}/drafts`：整会话草稿清单（刷新恢复载荷）；仅含用户自己的选择，永不带答案。
- 已提交 Unit 草稿冻结（409 `unit_locked`）；跨账号 404。

**Task 06 · Unit 正式提交**（本轮核心）
- `POST .../units/{suid}/submit`：整组提交、服务端判题，**单事务**完成：判题全部通过 → 逐题写入 `study_submitted_answers`（含 `answer_key_revision`）→ Unit 状态翻转为 `submitted`。任一题校验失败（422）则整体回滚，Unit 保持 pending 可重试——测试实证了「第一题合法、第二题选项非法 → 0 行写入」的原子性。
- **并发一致性**：提交先 `FOR UPDATE` 锁会话行（与 finish 同序，避免锁序死锁），再锁 Session Unit 行；并发/重复提交在锁后读到已提交状态，返回既有存储结果（`idempotent=true`），`(session_unit_id, question_id)` 主键使重复作答行不可能存在。「换答案重交」同样幂等——存储结果优先，不产生第二份记录。
- 未答 = `chosen_option_id IS NULL` + `is_correct IS NULL`（DB CHECK 强制），与错误明确区分；缺省题目按未答处理。
- 无答案键的题目拒绝判题（422 `answer_key_missing`），不猜测。

**Task 07 · 反馈权限**
- 正确答案/对错/解析**只存在于** `GET .../units/{suid}/feedback` 载荷，纯后端门控：
  - immediate 模式：该 Unit 正式提交后即开放（会话未结束也可）；
  - end 模式：会话正式结束（completed / ended_early）前一律 409 `feedback_locked_until_end`——提交响应体也不含任何正确性信息（测试断言了 flat 字符串无 `correct_option_id`/`is_correct`）；
  - 未正式提交的 Unit 永不开放（409 `unit_not_submitted`），已提交但会话提前结束的 Unit 在结束后可复盘。
- 提交响应在 immediate 模式内联 `feedback`（省一次请求）；end 模式无此字段。

**Task 08 · 练习结果**
- `finish` 语义升级：**全部 Unit 已提交** → `completed` + 同事务写入 `study_results`（`correct+wrong+skipped=total` 由 DB CHECK 强制）；**存在未提交 Unit** → `ended_early`，保留已提交答案、绝不生成成绩行（测试断言 `study_results` 0 行）。两者均幂等（completed 重入返回同一结果，`study_results.session_id` 唯一约束兜底）。
- 结果载荷：正确/错误/未答/总数、`score_rate`（correct/total）、`answered_accuracy`（correct/(correct+wrong)，全 skip 时为 null）、逐题复盘（chosen vs correct、is_correct、skipped、印刷题号）。
- `GET .../{sid}/results`：仅 completed 返回；ended_early 返回 409 `no_results_early_end`（明确说「没有完整成绩」，不伪造）；in_progress 返回 409。

## 测试结果（真实执行）

`backend/.venv/bin/python -m pytest`（隔离 `nhg_manabi_v2_test` 库；开发库未动）：

- 新增 `test_study_flow.py` **13 个测试全部通过**：草稿保存/修改/恢复/冲突/清除、非法选项与题目 422、提交后草稿冻结与跨账号、五空组类似的 2-slot 文法组原子提交 + 即时反馈、skip≠wrong（DB 断言 NULL/NULL）、错题判 false、**非法选项整组回滚且可重试**、**重复提交幂等零重复行**（含换答案重交）、校验与锁定、immediate 门控（未提交封存/他人 Unit 封存/跨账号）、end 模式结束前零泄漏、结束前不泄漏+结束后解锁、completed 全流程计分（1 对 1 错 1 skip，比率断言）+ 幂等单行结果、early end 无成绩 + 已提交答案保留。
- 全量回归：**87 passed**（Task 01–04 后为 74，新增 13，零回归）。
- `conftest.clean_study` 提升为共享 fixture；`test_practice_sessions.py` 改用之（原 finish 语义回归通过）。

## 与规范的偏差 / 已知边界

- `api-conventions.md` 建议「正式提交必须带 Idempotency-Key 请求头」。当前实现以**域级幂等**达成同等效果（主键 + 行锁 + 已提交状态短路），未引入幂等键存储表；待有真实重试链路需求（如弱网前端）再评估补建，暂不改规范文档。
- `user_question_progress`（错题/覆盖率缓存，P-009）**未**在提交时更新——M2 计划未要求，留给专项随机练习（M3）落地时实现；`study_submitted_answers` 保留全部历史，缓存可随时重建。
- `user_id` 继续走 `get_current_user_id`（ADR-0006）：服务端解析、fail-closed、`dev_test` 在 `APP_ENV=production` 硬禁用——正式邮箱登录体系仍属后续里程碑，本轮未改动认证机制。
- 提交响应的 `Idempotency-Key` 头当前未读取；`finish` 对 completed/ended_early 的幂等已覆盖主要重试场景。

## 收尾

- progress.md 更新（Task 05–08 移入已完成，下一步 M2.2 Task 09–11）。
- 无 ADR（无需求/架构变化；ADR-0006 身份边界延续）。
- 本日志与代码同批提交（`feat(api): implement drafts, submission and feedback`，对应计划提交 2）。
