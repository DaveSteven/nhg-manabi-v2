# 项目总体进度

最后更新：2026-11-16

## 已完成

- 项目文档体系（architecture / product / design / data / development / decisions ADR-0001~0004）。
- 后端骨架：FastAPI `/health`、SQLAlchemy 32 表 metadata、Alembic 0001 初始迁移（静态 DDL）。
- Docker Compose PostgreSQL 16（容器 `nhg-manabi-v2-db`，`127.0.0.1:55432`）。
- 数据库真实落地：迁移升级/回滚/再升级验证通过；32 表、32 CHECK、46 外键、60 索引。
- **Canonical staging importer**：验包/哈希/结构校验/幂等 staging 全流程；真实五套样本（N5–N1）已 staged，计数与规范基准吻合（20 Section/83 Layer/440 Unit/498 Question/204 Asset）；重复导入幂等；失败回滚带诊断；published 表保持为空。
- **Raw → Canonical 转换落地**：`scripts/canonical_v2.py` 收编入仓；对 Raw 原始数据（data/samples/N{1..5}）按级各抽一套完成转换，产物与既有 Canonical 包字节级一致（除时间戳），content_hash 逐包相同，端到端确定性验证成立。
- **M1.5 内容清洗审计与字幕时间轴**：原始 HTML 属性全量清单（A/B/C 分类）；Canonical 残留扫描零发现；字幕时间轴覆盖率 100%（1202 cue，143 Unit 全部配对音频，基准=Unit 音频）；越界 21 经 ffprobe 实测校对——17 个编码 padding 级可解释、4 个确证问题（N4 末段 cue 超出真实音频 ≤1282ms）待人工重对；大间隔 20 标 needs_review 固化回归；逐段播放数据兼容性测试通过；五包重转内容字节级一致（内容哈希零变化）；转换器 +0.1.1（属性审计）、验证器增强（缺失 vs 0、大间隔、时长越界）。
- **M1.6 审核与数据校验稳定化**：Alembic 0003（`content_issues` 表 + `content_reviews.sequence` 确定性顺序 + blocking 必须关联 Issue 的 CHECK）；`review_state.py` 按 sequence 的状态解析与显式 `resolve_issue`；Agent pass 不再能清除未解决争议；发布答案回查按 Unit 输入哈希过滤（旧哈希结论不跨版本泄漏）；promote 新增「当前哈希存在 open blocking 记录拒绝发布」门槛；`data_quality.py` 把验证器异常（cue 越界/缺失/非法/大间隔、材料分组等）幂等同步为可查询数据质量记录，重校验自动 resolved；N4 真实包已同步（20 条，4 个确证字幕越界 open blocking 可查询，幅度与 ffprobe 审计吻合）；ADR-0005。
- 测试：55 个测试全部通过（review_sync 12、data_quality 3、播放兼容 2、publisher/API 7、导入器 20、迁移一致性 2、Schema 编译 3、健康检查 1、真实 PG 约束 5 等在内）。
- **M2.1 Task 01–04（2026-11-16）**：开发前检查；题库查询 API 扩展（`GET /api/exams/{id}` 轮廓、`/layers` 目录、`GET /api/releases/{rid}/units/{uid}` 按 release 取 Unit，公开载荷零答案泄漏，draft 仍 404）；最小用户身份边界（`app/auth.py`，服务端解析 + fail-closed + dev_test 生产硬禁用，ADR-0006）；练习会话管理（`app/api/practice.py`：创建固定 release 绑定的单/多 Unit 会话、单活跃练习 409 冲突、恢复、跨账号 404 隔离、finish→ended_early 幂等且不生成虚假成绩）。测试增至 74 个全部通过。
- **ADR-0007 用户端混合渲染策略（2026-11-16，纯文档）**：React Router Framework Mode + SSG（品牌/内容页）+ SPA（学习系统），第一阶段禁用运行时 SSR，不引入 Next.js/Node SSR 服务。原建议编号 0005/0006 已被占用，顺延为 0007（M2 计划 Task 09 引用已修正）。`frontend-spec.md` 新增「页面渲染策略」章节为实现规范（页面分类、SSG/SPA 规范、SEO/多语言、静态部署路由规则、验收清单、SSR 升级条件）。两份并行起草的 ADR 已合并为单一 `ADR-0007-hybrid-rendering-strategy.md`。原「Task 09 前先写混合渲染 ADR」提前满足（实现仍在 M2.2）。无代码改动、未运行测试。
- **M2.1 Task 05–08（2026-11-16）**：答案草稿管理（`row_version` 乐观锁，409 带当前版本，旧请求不可覆盖新数据，清除/恢复/冻结齐全）；Unit 正式提交（**单事务整组提交 + 服务端判题**：会话行先锁、单元行后锁，并发/重复提交幂等返回存储结果且零重复作答行；非法选项整组回滚可重试；未答 = NULL/NULL ≠ 错误；无答案键拒绝判题）；反馈权限（正确答案/解析只经 feedback 端点门控下发——immediate 提交后开放该 Unit，end 模式会话正式结束前零泄漏含提交响应体）；练习结果（全部提交 → completed + 同事务 `study_results`，DB CHECK 保证 correct+wrong+skipped=total；有未提交 → ended_early 保留已提交答案且不生成成绩；结果含逐题复盘与 score_rate/answered_accuracy）。测试增至 87 个全部通过（新增 study_flow 13）。已知边界：Idempotency-Key 头未实现（域级幂等替代）、`user_question_progress` 留待 M3。

## 进行中（当前开发阶段）

- **M2 核心学习流程**（计划见 `docs/development/M2-core-learning-flow.md`）：FastAPI 作答引擎 → React 学习页面 → 端到端验收。**M2.1 全部完成（Task 01–08）**，下一步 M2.2 Task 09–11（React 学习页面）。
- **M2.2 前端实施准备（2026-11-16）**：新增 `docs/development/M2.2-frontend-implementation.md`，已明确 React Router Framework Mode SSG+SPA、学习首页、试卷目录、Canonical Unit/RichText/听力渲染、草稿与提交反馈、自动恢复及测试验收。可先实施工程/只读页面/renderer；答题闭环现在可直接对接 Task 05–08 已落地的 API（见下）与集成测试。`apps/web` 当前仍只有 README，未创建 React 工程。

## 未开始（按依赖顺序）

1. M2.2 React 学习页面（Task 09–11；实施计划、ADR-0007 与后端作答 API 契约均已就绪）。
2. 运行真实 Agent 校验（按 contract 批量产出五套题库结果 → sync → 解锁 promote）；N4 4 个确证字幕越界待人工重对时间轴（当前为 open blocking，阻止 N4 发布）。
3. N5/N3/N2/N1 逐包执行 `python -m app.data_quality sync`（M1.6 机制已就绪，按任务要求未自动全量跑）。
4. 发布快照不可变的 DB 触发器 / restricted DB role。
5. 认证/用户体系（当前内部 API 仅共享令牌；M2 Task 03 仅做最小身份边界）。

## 已知缺口 / 风险

- 未配置 ruff/mypy 等静态检查工具。
- 发布快照表无 DB 级不可变约束，靠应用纪律；restricted role 上线前必须补。
- Layer/Section 关联等 4 处真实数据包与 canonical-schema 草案不一致（见 2026-11-15 importer 日志），文档待修订。
- 转换器 `SELECTIONS` 硬编码；转换其余约 130 套归档前需改为按 `exams.json` 选择。
- `content_reviews.sequence` 在极端并发插入下按分配序入库（单进程 CLI 场景无影响）；多人并发审核工具上线前需评估。
