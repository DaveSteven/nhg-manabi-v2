# ADR-0025 放弃的模考不保留可见记录；practice 接口不处理模考会话

状态：已接受（用户 2026-11-18 确认）。补充 ADR-0024 的放弃流程；不改变数据库结构。

## 决定
1. 放弃的严格模考不产生任何学生可见的记录：无成绩、无逐题回顾、无历史条目。此前 Phase 已提交的答案也不能通过任何接口再读取（含普通 practice 的 feedback / transcript / results）。
2. `/api/practice/sessions/*` 全部端点只处理 `practice` 与 `quick_practice` 会话；模考会话 ID 与未知 ID 一样返回 404。模考的读写、放弃、成绩只走 `/api/mock-exams/*`，其 Phase 与计时规则不可被普通接口绕过。
3. 放弃仅把会话置 `abandoned`，不物理删除行（保留发布快照引用与审计，可由后续任务另行决定是否清理）。

## 后果
- 修复审查项 R3：普通 `finish` 不能再把进行中的模考改为 `ended_early`，也不能借普通 feedback 读取已提交 Phase 的答案。
- 模考成绩页的逐题回顾与独立模考历史入口仍待用户确认需求，本 ADR 不涉及。
