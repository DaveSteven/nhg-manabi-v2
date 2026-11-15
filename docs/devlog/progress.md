# 项目总体进度

最后更新：2026-11-15

## 已完成

- 项目文档体系（architecture / product / design / data / development / decisions ADR-0001~0004）。
- 后端骨架：FastAPI `/health`、SQLAlchemy 32 表 metadata、Alembic 0001 初始迁移（静态 DDL）。
- Docker Compose PostgreSQL 16（容器 `nhg-manabi-v2-db`，`127.0.0.1:55432`）。
- 数据库真实落地：迁移升级/回滚/再升级验证通过；32 表、32 CHECK、46 外键、60 索引。
- **Canonical staging importer**：验包/哈希/结构校验/幂等 staging 全流程；真实五套样本（N5–N1）已 staged，计数与规范基准吻合（20 Section/83 Layer/440 Unit/498 Question/204 Asset）；重复导入幂等；失败回滚带诊断；published 表保持为空。
- **Raw → Canonical 转换落地**：`scripts/canonical_v2.py` 收编入仓；对 Raw 原始数据（data/samples/N{1..5}）按级各抽一套完成转换，产物与既有 Canonical 包字节级一致（除时间戳），content_hash 逐包相同，端到端确定性验证成立。
- **发布事务 + API 答案隔离（M1 四条全部完成）**：staging → draft release 快照（幂等、publication_decisions 审计）；promote 晋升 published 有硬门槛（答案 human_reviewed / Unit complete / 媒体 verified），真实 N2 晋升被正确拒绝；内部 API（X-Internal-Token）可查 N2 文法五空组与读解材料，公开 API 无任何泄漏。
- 测试：36 个测试全部通过（publisher/API 5、导入器 20、迁移一致性 2、Schema 编译 3、健康检查 1、真实 PG 约束 5）。

## 进行中

- 无。

## 未开始（按依赖顺序）

1. 内容审核工作流（Agent 校验建议 → 人工复核写入 review_status → 解锁 promote）。
2. 发布快照不可变的 DB 触发器 / restricted DB role。
3. 认证/用户体系（当前内部 API 仅共享令牌）。
4. 作答 API（Session/Unit 提交、计分、自动保存恢复）。
5. React 前端（四学科首页、专项练习、历年试卷、我的学习）。

## 已知缺口 / 风险

- 未配置 ruff/mypy 等静态检查工具。
- 发布快照表无 DB 级不可变约束，靠应用纪律；restricted role 上线前必须补。
- Layer/Section 关联等 4 处真实数据包与 canonical-schema 草案不一致（见 2026-11-15 importer 日志），文档待修订。
- 全量 pytest 的 `clean_staging` fixture 会清空真实 staging 数据；跑完全量测试后需重跑 `python -m app.importer data/normalized_v2`（且 release 快照不迁移，需重新 publish draft）。
- 转换器 `SELECTIONS` 硬编码；转换其余约 130 套归档前需改为按 `exams.json` 选择。
