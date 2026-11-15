# 项目总体进度

最后更新：2026-11-15

## 已完成

- 项目文档体系（architecture / product / design / data / development / decisions ADR-0001~0004）。
- 后端骨架：FastAPI `/health`、SQLAlchemy 32 表 metadata、Alembic 0001 初始迁移（静态 DDL）。
- Docker Compose PostgreSQL 16（容器 `nhg-manabi-v2-db`，`127.0.0.1:55432`）。
- **数据库已真实落地**：迁移升级/回滚/再升级在真实 PG 16 上验证通过；32 表、32 CHECK、46 外键、60 索引确认存在。
- 测试：11 个测试全部通过（迁移一致性 parity 2、Schema 编译 3、健康检查 1、真实 PG 约束 5）。

## 进行中

- 无。

## 未开始（按依赖顺序）

1. Canonical staging importer（`docs/data/import-spec.md`）。
2. 内容审核流程与发布工作流（draft → published Release 快照）。
3. 作答 API（Session/Unit 提交、计分、自动保存恢复）。
4. React 前端（四学科首页、专项练习、历年试卷、我的学习）。

## 已知缺口 / 风险

- 未配置 ruff/mypy 等静态检查工具。
- 无 restricted DB role；发布前必须补权限分离。
- 题库无任何数据；未审核内容不可公开。
