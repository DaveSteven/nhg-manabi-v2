# 开发日志 · 2026-11-15 · Git 仓库初始化与数据库落地

## 任务范围

1. 初始化 Git 仓库并关联远程 `git@github.com:DaveSteven/nhg-manabi-v2.git`。
2. 在真实 PostgreSQL 16 上落地数据库（AGENTS.md 第六节所述「无真正迁移执行记录」的缺口）。

## 改动内容

### Git

- `git init -b main`，remote → `git@github.com:DaveSteven/nhg-manabi-v2.git`，首提交 `9d2df76` 已推送 `origin/main`。
- `.env` 从 `.env.example` 生成（随机密码），已被 `.gitignore` 排除，未入库。

### 数据库

- `docker compose up -d`：启动 `postgres:16-alpine` 容器 `nhg-manabi-v2-db`，端口 `127.0.0.1:55432`，数据卷 `nhg_manabi_v2_pgdata`。未触碰旧项目 `nhg-manabi` 的容器。
- 新增 `backend/tests/test_migration_parity.py`：将 Alembic 0001 静态 DDL 与 SQLAlchemy metadata 编译结果逐条对比，防止 metadata 修改后忘记新增 revision。
- 新增 `backend/tests/test_constraints_pg.py`：对真实 PG 验证约束（无 `DATABASE_URL` 自动跳过）。

### 未改动

- Schema 本身（32 表 metadata、Alembic 0001）未做任何修改。

## 实际执行的测试与结果

以下全部为真实执行结果，无虚报：

| 检查 | 命令 | 结果 |
|---|---|---|
| 迁移升级 | `alembic upgrade head` | 成功，`0001_initial_schema (head)` |
| 表数量 | `information_schema` 查询 | 33（32 业务表 + `alembic_version`） |
| 约束数量 | `pg_constraint` 查询 | CHECK 32、外键 46 |
| 索引数量 | `pg_indexes` 查询 | 60 |
| 约束验证 | `pytest tests/test_constraints_pg.py` | **5 passed**（结果总数 CHECK、每用户单活跃练习会话部分唯一索引、答案键外键、mock 会话必须带 release、考试等级 CHECK） |
| 回滚 | `alembic downgrade base` | 成功，业务表全部删除，仅剩 Alembic 自身 `alembic_version`（预期行为） |
| 再升级 | `alembic upgrade head` | 成功，恢复 33 表 |
| 全量测试 | `pytest`（单元 + parity + PG 约束） | **11 passed, 0 failed** |
| API 冒烟 | TestClient `GET /health` + DB 连接 | 200 `{'status': 'ok', ...}`，DB 33 表 |

**未执行的检查**：ruff/mypy 静态检查（仓库尚未配置）；前端无改动故未跑。

## 开发过程记录

- 约束测试三轮才通过，原因均为测试自身的种子/清理缺陷（种子缺 `question_registry` 记录、清理 SQL 引用了不存在的列、残留随机 rid 链未清干净），**不是 Schema 或迁移缺陷**；已改为按 `exam_id = 'exam-test'` 子查询统一清理，测试可重复运行且无残留。

## 架构决策

无架构决策变化，未新增 ADR。迁移仍沿用 0001 的静态 DDL 方案；parity 测试只是防护，不改变决策。

## 剩余风险与后续

- `exam_catalogs` 等表无种子数据，导入管线（staging importer）尚未开始。
- 发布角色/权限分离（restricted DB role）在 Schema 注释中标注为上线前必做，当前仅单用户 `nhg_v2`。
- `.env` 密码为本机开发用，部署时须更换。
