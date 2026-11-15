# 项目总体进度

最后更新：2026-11-15

## 已完成

- 项目文档体系（architecture / product / design / data / development / decisions ADR-0001~0004）。
- 后端骨架：FastAPI `/health`、SQLAlchemy 32 表 metadata、Alembic 0001 初始迁移（静态 DDL）。
- Docker Compose PostgreSQL 16（容器 `nhg-manabi-v2-db`，`127.0.0.1:55432`）。
- 数据库真实落地：迁移升级/回滚/再升级验证通过；32 表、32 CHECK、46 外键、60 索引。
- **Canonical staging importer**：验包/哈希/结构校验/幂等 staging 全流程；真实五套样本（N5–N1）已 staged，计数与规范基准吻合（20 Section/83 Layer/440 Unit/498 Question/204 Asset）；重复导入幂等；失败回滚带诊断；published 表保持为空。
- 测试：30 个测试全部通过（导入器 19、迁移一致性 2、Schema 编译 3、健康检查 1、真实 PG 约束 5）。

## 进行中

- 无。

## 未开始（按依赖顺序）

1. 发布事务：staging → 不可变 release 快照 + current 指针（M1 最后一条，含答案可见性权限验证）。
2. 基于 release 的只读题库查询 API + 内部/公开权限隔离。
3. 内容审核工作流（Agent 校验建议 → 人工复核 → publication_decisions）。
4. 作答 API（Session/Unit 提交、计分、自动保存恢复）。
5. React 前端（四学科首页、专项练习、历年试卷、我的学习）。

## 已知缺口 / 风险

- 未配置 ruff/mypy 等静态检查工具。
- 无 restricted DB role；发布前必须补权限分离。
- Layer/Section 关联等 4 处真实数据包与 canonical-schema 草案不一致（见 2026-11-15 importer 日志），文档待修订。
- `answer_keys` 在 staging 以 jsonb 存储，API 层必须显式过滤，不得依赖文件名隔离。
