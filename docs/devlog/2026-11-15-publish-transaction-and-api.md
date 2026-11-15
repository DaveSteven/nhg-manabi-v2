# 开发日志 · 2026-11-15 · 发布事务与内部/公开 API 答案隔离

## 任务范围

M1 最后一条：发布事务（staging → 不可变 release 快照 + current 指针）与 API 权限隔离——授权内部 API 可查 N2 文法五空组与读解材料，公开 API 不泄漏答案。

## 改动内容

新增 `backend/app/publisher.py`、`app/publisher_cli.py`、`app/api/content.py`；`main.py` 挂载 content 路由；新增 `tests/test_publisher.py`（5 个测试）。

**发布事务设计**：
- `publish`：从 staging 重建 CanonicalPackage → 复检结构校验 → 单事务写入注册表（exam_catalogs / question_registry / question_types / media_assets，均幂等 upsert，媒体 sha256 冲突则报错）→ release 快照全部表 → `publication_decisions` 审计行。快照初始 `state='draft'`（仅内部可见），**不切 current 指针**。
- `promote`：draft → published + 切换 `exam_current_releases` 指针，硬性门槛：全部答案键 `human_reviewed`、全部 Unit `conversion_status='complete'`（A/B 启发式切分被拦截）、全部被引用媒体 `verified`。不满足则 `PublishGateError` 拒绝，状态不变。
- 幂等：同 `(exam_id, content_hash)` 返回既有 release；withdrawn 不可复活，须新建 release。
- Layer→Section 的 subject 映射在发布时转换为 `section_id`（canonical 格式与 DB 投影的差异点，见 importer 日志）。

**API 边界**：
- 公开 `/api/exams`、`/api/exams/{exam}/units/{unit}`：仅 `published` 且为 current 指针的 release；响应**永不包含** answer_key、correct_option_id、review_status、explanations、cues；非 complete Unit 404。
- 内部 `/internal/exams/{exam}/units/{unit}`：需 `X-Internal-Token == INTERNAL_API_TOKEN` 环境变量；未配置时一律 403（宁可拒绝不可泄漏），返回含答案键/解析/字幕的完整 payload。

## 实际执行的测试与结果

| 检查 | 结果 |
|---|---|
| pytest 全量 | **36 passed**（publisher/API 5：快照计数、发布幂等、未审核拒绝、审核后晋升+指针、公开 API 泄漏检查） |
| 真实 N2 发布 | release `81e42290…`，`state=draft`，revision=1 |
| 真实 N2 晋升 | **被拒绝**：`103 answer key(s) not human_reviewed`，状态保持 draft、无指针（红线在真实数据生效） |
| 内部 API 验收 | N2 文法問題9 五空 Unit：200，5 slots/5 questions，slot 绑定一致，答案键+6 解析齐备；读解問題10 前三篇：200，正文 250/283/212 字，印刷题号 53–55 保留 |
| 公开 API 验收 | `/api/exams` = `[]`；N2 unit → 404 |

**未执行的检查**：真实 HTTP 服务器 + curl（用 TestClient 等价覆盖）；认证/用户体系（尚不存在，M1 用 token 代替）；发布快照不可变 DB 触发器/角色权限（已记录为风险）。

## 过程记录

- 发布事务两处真实缺陷由测试/真实验证暴露并修复：Layer subject→section_id 映射缺失、question_types 字典表未写入。
- 全量 pytest 的 `clean_staging` fixture 会清空真实 staging（既有设计），真实数据发布前需重跑 `python -m app.importer`。本轮已重新导入。

## 架构决策

无新增架构决策。draft/published 两段式与晋升门槛均为既有 ADR-0004 与 content-review-policy 的落地。未新增 ADR。

## 剩余风险与后续

- 发布快照表无 DB 级不可变触发器/restricted role，靠应用纪律保证；上线前必须补（schema 注释已标注）。
- INTERNAL_API_TOKEN 为简单共享令牌，非正式认证体系；用户体系在作答模块之前需要决策。
- 内容审核工作流（Agent 建议 → 人工复核写入 review_status）是解锁 promote 的前置任务。
