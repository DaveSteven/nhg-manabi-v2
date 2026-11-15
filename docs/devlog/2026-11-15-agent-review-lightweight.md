# 开发日志 · 2026-11-15 · 内容审核流程轻量化改造

## 任务范围

将「必须人工审核才能发布」调整为「本地 Agent 校验优先，异常人工复核」，按任务清单 10 项实施。

## 改动内容

| 项 | 实现 |
|---|---|
| Alembic 0002 | `0002_review_constraints`：`release_answer_keys`/`release_explanations`/`content_reviews` 的 review_status CHECK 枚举（含新增 `agent_verified`）、`content_reviews.reviewer_type` CHECK、审核身份唯一键 `uq_content_review_identity`。已在真实 PG 验证 upgrade→downgrade→upgrade |
| 同步模块 | `app/review_sync.py`：`build`（按 agent-validation-contract 生成绑定 content_hash 的 Unit 审核任务）+ `sync`（JSONL 批量同步：过期哈希/非法选项/修订冲突/人工冲突拦截，幂等去重，修改审计全部落 `content_reviews`）+ CLI（`python -m app.review_sync build/sync`） |
| publisher | 发布时答案状态从 `content_reviews`（哈希绑定证据）取最新值；promote 门槛改为 `agent_verified`/`human_reviewed`；新增 Agent 存疑 Unit 拦截（绑定当前哈希的 needs_review/blocked 即拒绝）；新增独立 `rights_confirmed` 版权门槛 + `confirm-rights` CLI |
| 测试库隔离 | `tests/conftest.py`：会话级 `test_db_url`（DATABASE_URL 派生 `<db>_test`，自动建库+迁移），全部 DB 测试跑测试库，真实开发库零接触。修复了此前全量 pytest 清空真实 staging 的问题 |
| 文档 | AGENTS.md 红线新增轻量化流程两条；content-review-policy.md 新增「轻量化审核流程」节；本日志 + progress.md |

**未做**（按任务要求）：多人审核、任务分配、审核后台、强制逐题人工审批、Agent 自动发布。

## 实际执行的测试与结果

- pytest 全量：**46 passed, 0 failed**（新增 review_sync 测试 9：批量应用、幂等重放、过期哈希拦截、非法选项拦截、不同选项提案不视为通过、修订冲突拦截、人工争议冲突拦截、全量校验后通过发布门槛、存疑 Unit 阻断发布、已发布 Release 不被 Agent 修改）。
- 迁移 0002 在真实 PG：upgrade → downgrade → upgrade 全通过。
- 真实开发库完好性：全量测试后 `import_jobs=5`、`import_records=2513`、N2 draft release 完好——**测试不再触碰真实数据**。
- 真实 N2 演示（结果已回滚清理，仅保留记录）：
  - 篡改哈希批次 → `stale_content_hash` 拦截；
  - 文法五空组（5 题）+ 读解一篇（1 题）演示批次 → 6 个 `agent_verified` 写入 draft release；
  - 重放同批次 → `already_present_count=5`，零新增行；
  - promote → 「97 answer key(s) lack a valid verdict」——已校验 6 题通过答案门槛，拒绝来自剩余未校验项，存疑内容无法绕过；
  - 演示后已删除 8 条 demo 审核行并把 6 个 key 重置 `unverified`（避免开发库残留假审核状态；全量「校验→发布」完整路径已在隔离测试库以 `test_full_verified_batch_passes_promote` 验证）。

**未执行的检查**：ruff/mypy（仍未配置）；真实外部 Agent（同步接口以演示批次验证，协议格式对齐 contract 文档）。

## 过程记录

- 修复：alembic 包无 `__main__`（改用 `alembic.command` API）；SQLAlchemy 2.1 `str(url)` 隐藏密码（改用 `render_as_string(hide_password=False)`）；约束测试种子的 `'approved'` 不在新 CHECK 枚举（改 `human_reviewed`）；API 测试 app 需显式指向测试库。

## 架构决策

无新增 ADR：轻量化流程是对 ADR-0004 与本政策既有原则的落地，`agent_verified` 通过新增 Alembic Revision 实施（任务清单第 4 条方式）。

## 剩余风险与后续

- `content_reviews` 的「最新判定」按 `checked_at` 排序，同秒批次顺序不确定（当前业务可接受；后续可加序列列）。
- Agent 单元判定「latest pass 可清除早前 needs_review」是当前政策选择；如需更保守（任一存疑即永久阻断），需产品确认后调整 promote 查询。
- 真实 Agent 校验尚未运行；五套题库当前仍全部 `unverified`，不可发布。
