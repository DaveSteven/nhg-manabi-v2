# JLPT GO 2.0 — M1 工程落地说明

- 项目根目录：`nhg-manabi-v2`，与旧版 `nhg-manabi` 完全独立。
- 本次已提供：Docker Compose（PostgreSQL 16）、FastAPI 基础入口、SQLAlchemy 32 表元数据、Alembic 初始迁移、自动检查脚本。
- 数据库名称：`nhg_manabi_v2`；本地端口：`127.0.0.1:55432`。
- Alembic 迁移仅生成并通过**离线 SQL 编译验证**，没有实际启动 PostgreSQL 或执行数据库迁移；实际连接、约束、发布事务仍需在本机 PostgreSQL 实例中验证。
- 5 包 Canonical Archive 的文件哈希、数量检查已通过：20 Section / 83 Layer / 440 Unit / 498 Question / 204 MediaAsset。
- **暂未实现：**Canonical→staging 写入、审核/发布业务逻辑、权限隔离与 published 快照不可变触发器、完整用户 API、前端应用。
- 正式发布前，必须确认题库授权与所有内容审核状态，不能把结构转换结果直接对外开放。
- 下一步：本地启动 PostgreSQL、执行 `alembic upgrade head`、验证反向回滚和数据关联，再开发 staging importer。
