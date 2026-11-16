# ADR-0012 本地 Docker 部署拓扑

状态：已接受（用户 2026-11-16 指示"先部署到本地 docker"）。仅覆盖**本机**，不是生产方案。

## 决策
`compose.yaml` 增加三个服务，与既有 `postgres` 同属 v2 项目：
- `migrate`：一次性 `alembic upgrade head`，成功后 `api` 才启动（运行时不建表）。
- `api`：`backend/Dockerfile`，uvicorn 无 `--reload`；媒体目录 `data/v2-media` **只读**挂载（6.8G 不进镜像），邮件密钥从可选的 `backend/.env` 注入，`APP_BASE_URL` 指向 `http://localhost:8080`。
- `web`：`deploy/web.Dockerfile` 多阶段构建 `apps/web` 与 `apps/admin`，nginx 提供静态文件并将 `/api/` 反代到 `api:8000`。学生端 `:8080`、管理端 `:8081`，均只绑定 127.0.0.1。

学生端路由遵循 ADR-0007：`/` 为预渲染品牌页，`/study`、`/login` 等 SPA 路由回落 noindex 的 `__spa-fallback.html`，未知路径真 404，品牌页不作全局 fallback。

## 取舍
- 前端构建用 `pnpm install --ignore-scripts`：pnpm 12 对未审批的 `@parcel/watcher` 构建脚本报错，构建本身不需要它。
- 本机热重载开发流程（`uvicorn --reload`、Vite dev）保持不变，两者可并存；容器使用同一数据库卷，数据与手动启动一致。
- 不含 TLS、备份、日志收集、生产域名、restricted DB role，这些仍是上线前置项。
