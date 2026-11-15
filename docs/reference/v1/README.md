# JLPT GO 1.0 参考资料（只读）

本目录保存用户提供的 **1.0 原始文档副本**，供理解产品背景、现有能力、可复用经验、迁移风险和旧系统限制使用。不得将本目录视为 `nhg-manabi-v2` 的实现要求，也不得直接以此对 1.0 数据库执行写操作。

- `frontend.md`：旧学生端及管理端 React 组件、状态管理、路由和校对工作台记录。
- `database-schema.md`：旧版 SQLAlchemy ORM、练习会话/历史、用户表等。
- `design-system.md`：旧版「樱与墨」设计语言、tokens、主题和交互规范。

**与 2.0 明确冲突处**：1.0 的实心凸起 Tab → 2.0 页面级下划线 Tab；1.0 较广的衬线字体用途 → 2.0 以无衬线为主，长文章可用 Noto Serif JP；1.0 首页每日目标、motivation 卡 → 不成为 2.0 首页核心；1.0 由 `ensure_schema` 增量改表 → 2.0 仅使用 Alembic 迁移；1.0 数值题型/原始 ID → 2.0 Canonical 语义 ID/Unit。

**缺失的旧文件**：原始文档有时引用 `architecture.md`、`state-management.md`、`decisions.md`、`_base.scss` 等，但这些文件本次没有提供，请勿根据相对引用假装它们已在本仓库。
