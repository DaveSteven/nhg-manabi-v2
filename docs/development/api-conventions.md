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

## 并发和幂等

- 正式提交必须带唯一 idempotency key，重复请求返回相同已提交结果。
- 选项保存包含 `expected_version`，服务器拒绝过时版本并返回可恢复的冲突信息。
- 试卷 release 在 Session 开始时固定；新的 release 不能改变进行中的考试数据。
- 状态写入与结果统计同事务，禁止部分成功导致重复记分。

## 公开内容与媒体

- 媒体必须通过可访问性、MIME 签名和权限检查；前端不可访问内部原始 ZIP 和私有答案 JSONL。
- 已通过结构转换但内容未审查的测试样本只在本地/封闭测试可读，不能自动成为公开练习数据。
