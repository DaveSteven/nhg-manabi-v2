# JLPT GO 2.0 系统架构与技术约束

## 部署/模块边界

- **单仓库 Monorepo**：`apps/web` 学生 React 端、`apps/admin` 内容后台、`backend` FastAPI + SQLAlchemy + Alembic、`data/samples` 开发样本、`docs` 规范。
- **模块化单体**：一个 FastAPI 后端，领域分别是 `auth`、`content`、`importers`、`practice`、`learning`、`admin`；共享 PostgreSQL 16；暂不引入微服务、Redis、Elasticsearch、消息队列。
- 开发 PostgreSQL 使用 `compose.yaml` 内独立容器，数据库名 `nhg_manabi_v2`，默认绑定 `127.0.0.1:55432`；与 1.0 没有 DB/Volume/网络迁移关系。实际密码仅在本机 `.env`。
- 文件（原始 ZIP、媒体二进制、canonical 包）与关系库有独立存储职责；生产环境可用文件服务/对象存储，但不在本文擅自锁定提供商。

## 数据来源链路

`Raw（只读） → ETL → Canonical v2.0 Draft → Staging + Validator → Agent/人工审核 → 发布批准 → 不可变 Release → 学生 API/练习 Session`。

Canonical 是**交换数据标准**；Postgres 是**事务/查询投影**。每个稳定业务对象有 JLPT GO 自有 ID，来源 objectId 只保留在内部 provenance。`release_id` 是内容快照边界，不以 `updated_at` 动态覆盖旧内容。

## 核心内容/练习关系

- `exam_catalogs` 标识逻辑试卷；`exam_releases` 标识版本；Section/Layer/Unit/Question/Options/AnswerKey/Explanation 是 release 范围内不可变内容。
- 一次普通随机练习可从多个 release 选 Unit，**每个 `study_session_units` 明确 `(release_id, unit_id)`**；Session 不强制同卷。
- 一个严格 mock 固定整张试卷 release 与经验证的考试 Phase/播放规则。
- `study_answer_drafts` 可编辑、带行版本；`study_submitted_answers` 一旦提交不可改写；`study_results` 是结束后成绩；`user_question_progress` 是可重建派生视图/缓存。

## 不可越过的边界

- 用户作答接口不能提前返回正确答案或隐藏解析 HTML；答案字段通过独立权限/查询模型隔离。
- Admin Agent 不能直接修改发布库或已发布 release；修订先进入 staging。
- 富文本来自 Canonical RichText，不直接把上游 HTML 原样发给浏览器。
- 正式发布必须同时满足结构、内容质量、媒体可用性及权利许可审核。
- PostgreSQL DDL 由 Alembic 管理；生产发布不能靠应用启动时偷偷 ALTER TABLE。
- 1.0 只读参考：不共享本地 DB 密码、不重用旧服务器目录或部署脚本覆盖生产。

## 环境与当前完成度

| 项目 | 当前状态 |
|---|---|
| 工程骨架 + Compose | 已生成，需在用户机器验证 Docker 真正启动 |
| SQLAlchemy 32 表 + Alembic `0001` | 已生成离线验证；尚未在真实 PG 执行 |
| Canonical 五套验证包 | 数据包校验通过，语言学校验和授权未完成 |
| Canonical staging importer | 未实现 |
| 内容 release 发布事务、不可变保护 | 设计阶段 |
| React 学生端与后台 | 预留目录，尚未实现 |
| Auth、Practice、Learning API | 尚未实现 |

## 模块代码的建议界面

- Content：公开目录/单元查询，对外 DTO 排除答案；内部内容读取包含 release。
- Import：文件 SHA-256、JSON Schema、完整关系、去重、暂存错误；不负责自动批准发布。
- Practice：选 Unit/Session、保存草稿、正式提交、判题、结果，服务端事务/幂等。
- Learning：从正式作答事件生成个人记录及错题/覆盖率统计；缓存可重算。
- Admin：复核、存疑处理、候选版本、审核日志、发布开关；独立权限。
