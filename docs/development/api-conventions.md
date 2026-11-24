# API 契约设计原则（待实现）

> 此为新 API 建议约定，非现存端点清单。版本前缀可用 `/api/v1`（API 版本和项目 2.0 是不同概念）。

## 资源类别与响应权限

| 资源/示例（建议） | 用途 | 关键限制 |
|---|---|---|
| `GET /api/v1/exams` | 可见的试卷目录 | 不暴露 draft/blocked 发布内容 |
| `GET /api/v1/exams/{id}` | release 内容目录 | 不带答案索引/未公开解析 |
| `GET /api/v1/units/{unitId}` | 完整 Unit 材料/题目 | 必须确定具体 release，跨卷需独立定位 |
| `POST /api/v1/practice/sessions` | 根据等级/题型/数量抽题创建会话 | 单个活跃普通 Session 约束，报冲突提示 |
| `GET /api/v1/practice/sessions/{id}` | 恢复固定题组和草稿 | 只允许本人访问；答案显示权限按模式判断 |
| `PUT /api/v1/practice/sessions/{id}/drafts` | 保存选项草稿 | 使用 row_version / expected_version |
| `POST /api/v1/practice/sessions/{id}/units/{sessionUnitId}/submit` | 提交完整 Unit | 请求需 Idempotency-Key；返回仅授权反馈 |
| `POST /api/v1/practice/sessions/{id}/finish` | 整次最终提交/交卷 | 事务化计算和锁定，幂等返回结果 |
| `GET /api/v1/me/question-progress` | 错题/覆盖率 | 去重、按本人，解释统计口径 |

以上路径是建议，正式 OpenAPI 设计前先确认公共资源定位规则（如 `(releaseId, unitId)`），不要用当前可变 release 指针定位正在作答的历史 Unit。

## 交换格式和时序

- JSON UTF-8，API 字段名建议 `snake_case` 与 Python 统一，前端可建立类型映射层；日期 ISO 8601 + UTC。
- Query 返回结构带稳定 ID、明确位置 `position` 与 `printed_number`，不要以数组排序推断印刷号。
- API `data` 与可见答案 DTO 分开；普通 GET 单元不含 `correct_option_id`、私人 explanation。
- 失败响应统一 machine code + human-readable message + optional details/request_id，不能把堆栈泄漏给用户。
- 401 未认证、403 未授权、404 不可访问/不存在、409 并发会话/版本冲突、422 校验失败；上传大小与限流另定。
- 管理端使用单独权限（至少内容校验/发布角色），校验 Agent 不应拥有直接发布权限。
- 管理端认证（ADR-0009）：`POST /api/admin/auth/login` 换取不透明 Bearer 令牌（12 小时绝对过期，可撤回，库内只存 SHA-256）；缺失/无效/过期令牌 401，角色不足 403（viewer ⊂ reviewer ⊂ publisher）；登录失败一律同一 401 响应，连续 5 次失败锁定 15 分钟；无 dev_test 旁路，学生令牌与管理员令牌互不通用。审核/发布记录的 `reviewer_id` 由服务端写为 `admin:<id>`，不接受客户端传入。
- 扩展练习（ADR-0030）：`GET /api/supplementary/lessons?level=` 返回该等级各科目的课程（题数只计可练习题；`answered/correct/wrong` 来自本人最近有效结果）；`POST /api/supplementary/sessions {exam_id, feedback_mode}` 以该课全部可练习 Unit（固定顺序）创建普通 `practice` 会话，`config.supplementary` 记录课程信息，沿用 ADR-0016 的单名额替换；非扩展课或不可练习返回 404 `lesson_not_found`。需要登录，响应不含答案。扩展课不进入历年试卷目录、专项抽样、`/api/me/learning/*`。
- 管理端导出 Word：`GET /api/admin/releases/{release_id}/export?kind=paper|answers` 返回 .docx 附件（试题不含答案；答案文档含答案一览、解析与听力原文，不含音频）；仅管理员会话，学生端无对应接口。
- 管理端重置学生密码（ADR-0029）：`POST /api/admin/users/{id}/reset-password` 返回一次性 `temporary_password`，撤销该用户全部会话并写审计 `user_password_reset`（不记录口令）。
- 学生端账户认证（ADR-0011）：`POST /api/auth/register`（邮箱+密码，注册后未验证不可登录）、`login`（ADR-0029：`identifier` 为邮箱或用户名，含 `@` 即邮箱；旧参数名 `email` 兼容；用户名小写唯一，`email` 可空）、`logout`、`verify-email`、`resend-verification`、`forgot-password`、`reset-password`；`GET/PATCH /api/me`（display_name、current_level；响应含 `username`，`email` 可为 null）。会话为 30 天绝对过期的不透明 Bearer 令牌（库内只存 SHA-256，可撤销）；登录失败/未验证/停用/锁定一律同一 401；`resend-verification` 与 `forgot-password` 对任何账号状态统一 200，不泄漏存在性；注册与重置的字段级错误返回 400 `{"detail":{"field","message"}}`；重置成功撤销该用户全部会话；登录连续失败 5 次锁定 15 分钟。作答域身份仍由 `get_current_user_id` 服务端解析：真实会话令牌优先，`AUTH_MODE=dev_test` 仅非生产可用（ADR-0006 语义不变）。

## 严格模拟 API（ADR-0019，2026-11-18 已实现后端）

| 端点 | 说明 |
|---|---|
| `GET /api/exams/{id}/mock` | 公开：该试卷是否可模考（`available`/`reason`/Phase 与时限），不含内容与答案 |
| `POST /api/mock-exams` `{exam_id}` | 开始模考：固定当前 release，开始第 1 个 Phase 计时；独立名额，不影响练习/Quick（ADR-0020）；已有进行中模考 → 409 `mock_in_progress`（带 session_id），`replace_active=true` 才放弃旧模考；不可模考 → 422 `mock_not_available` |
| `GET /api/mock-exams/current` / `{id}` | 权威状态（含 `server_now`、各 Phase `status/expires_at/remaining_seconds`、仅当前 Phase 的 `active_units`）；读取时顺带封存已到期 Phase |
| `GET /api/mock-exams/{id}/units/{sessionUnitId}` | 无答案 Unit 内容，仅限当前 Phase，否则 409 `unit_not_in_active_phase` |
| `PUT .../units/{suid}/drafts`、`GET .../drafts` | 草稿（row_version 乐观锁，同练习）；恢复只返回当前 Phase |
| `POST /api/mock-exams/{id}/phases/{phaseId}/submit` | 交本 Phase；Phase 写在路径上，重复/重试对已关闭 Phase 幂等，绝不会误关下一个 Phase |
| `POST .../units/{suid}/audio/{materialId}/start` | 登记音频唯一一次播放（幂等）；返回 `state`(idle/playing/ended)、`position_ms`、`duration_ms`；`/content` 的每个 Unit 也带 `audio` 状态。连续听力模式下返回 409 `continuous_audio` |
| `POST .../phases/{phaseId}/audio/start` | 连续听力（ADR-0022）：登记本阶段完整录音的唯一一次播放（幂等）；仅当前进行中的阶段，否则 409 `phase_not_active`；无可用完整录音 404。`/content` 带 `phase_audio`（`asset_id`、`state`、`position_ms`、`duration_ms`，非连续模式为 null），连续模式下各 Unit 不再下发音频片段 |
| `GET /api/mock-exams/{id}/results` | 最后一个 Phase 关闭后才开放：试卷信息、用时、各 Phase/科目答对数与正确率、逐题（含 session_unit_id/phase/subject）；之前 409 `mock_not_finished` |
| `GET /api/mock-exams/{id}/units/{su}/feedback` · `/transcript` | 整场完成后才开放的只读回顾（解析/正确答案/听力原文）；未完成 409 `mock_not_finished`，非本人 404（ADR-0027） |
| `GET /api/exams/{exam_id}/mock-results` | 本人对该试卷已完成的模考列表（新到旧） |
| `GET /api/me/learning/history?kind=all\|quick\|topic\|mock` | 练习历史；含已完成模考（`mode=mock`，进入模考成绩页） |

服务端无后台任务：到期封存发生在任何访问该会话的请求中，按已存草稿正式提交，未选为 skip，下一 Phase 自上一 Phase 到期时刻起计时。模考答案不写入 `user_question_progress`，也不进入练习历史/概览。

## 并发和幂等

- 正式提交必须带唯一 idempotency key，重复请求返回相同已提交结果。
- 选项保存包含 `expected_version`，服务器拒绝过时版本并返回可恢复的冲突信息。
- 试卷 release 在 Session 开始时固定；新的 release 不能改变进行中的考试数据。
- 状态写入与结果统计同事务，禁止部分成功导致重复记分。

## 公开内容与媒体

- 媒体必须通过可访问性、MIME 签名和权限检查；前端不可访问内部原始 ZIP 和私有答案 JSONL。
- 已通过结构转换但内容未审查的测试样本只在本地/封闭测试可读，不能自动成为公开练习数据。
