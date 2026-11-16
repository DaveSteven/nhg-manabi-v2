# 部署与环境隔离规范（设计稿）

## 环境

| 环境 | 目标 | 状态 |
|---|---|---|
| 本地 v2 dev | Docker PostgreSQL、FastAPI 热重载、React 开发 | Compose 工程配置已提供，需用户本地启动验证 |
| v2 测试 | 独立数据库、测试 media/assets、有限测试用户 | 尚未部署 |
| v2 生产 | 独立于 1.0 的服务、域名/反向代理、备份、日志 | 尚未部署，待合规与内容审核 |

## 首次本地启动（只针对 v2）

```bash
cd nhg-manabi-v2
cp .env.example .env
# 修改仅用于开发的密码和数据库连接信息

docker compose --env-file .env up -d postgres

cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
set -a; source ../.env; set +a
alembic upgrade head
uvicorn app.main:app --reload --port 8001
```

检查 `/health` 只是进程活性，不等于数据库 readiness；必须加真实 `SELECT 1`/迁移版本检查再认为 M0 完成。

## 本地全容器运行（ADR-0012）

```bash
docker compose --env-file .env up -d --build
```

学生端 `http://localhost:8080`，管理端 `http://localhost:8081`，API 仅经二者的 `/api/` 反代访问。`migrate` 自动升级到最新迁移；媒体目录只读挂载 `data/v2-media`。停止：`docker compose --env-file .env down`（不加 `-v`，数据卷保留）。端口 8000/5432 属于其他项目容器，勿占用。

## 学生账户邮件配置（ADR-0011）

后端额外读取（可放在 `backend/.env`）：

- `RESEND_API_KEY`：Resend API 密钥；**未设置时为本地开发模式**，验证/重置链接追加写入 `backend/.local/dev-email.log`（不打真实邮件、注册不失败）。
- `MAIL_FROM`：发件人（如 `JLPT GO <noreply@example.com>`），生产必配。
- `APP_BASE_URL`：邮件链接指向的学生端地址（本地默认 `http://localhost:5173`；生产改为正式域名）。

生产部署 checklist 必须包含以上三项；缺 key 的生产部署会让用户收不到验证/重置邮件（服务端日志有 error）。

## 变更与备份

- 禁止把 v2 migration 或 Docker Compose 的挂载目录指向 v1 线上数据库/Volumes/服务器发布目录。
- 每次生产迁移前做版本化 `pg_dump`/快照并验证可恢复；先测试环境演练升级和必要回滚。
- Alembic 迁移文件 Git 管理，已部署历史 migration 不能原地编辑；版本同步由人工审核。
- 导入任务先写 staging，检查 SHA-256、关联、存疑状态、版权放行，再事务化发布。
- 发布内容版本不可静默覆盖；回退通过 current release 指针/版本处理，不删除历史答案。

## 操作性安全

- `.env` 不纳入 Git；开发环境限制本机监听，生产 DB 不公网暴露。
- 配置 HTTPS、最小权限角色、API 限流、管理员审计日志；媒体文件授权存储和正确 MIME。
- 数据库、Canonical 包、媒体和运行日志分别实施备份与保留策略；个人学习历史属于用户敏感数据。
- 题库语言学校验完成≠拥有合法发布权；对外开放前需解决来源内容/媒体使用权。

## 当前不应执行的事

在没有用户指定部署目标、连接信息和批准的情况下，不向 ConoHa/1.0 服务器发布、不执行正式库 DDL、不改变 1.0 的数据或代理规则。
