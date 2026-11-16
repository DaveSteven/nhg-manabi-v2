# devlog · 2026-11-16 · 本地 Docker 部署

## 范围
把 API 与前端也放进 Docker（此前只有 PostgreSQL），仅本机；ADR-0012。

## 改动
`backend/Dockerfile`、`deploy/web.Dockerfile`、`deploy/nginx.conf`、`.dockerignore`、`compose.yaml` 增加 migrate/api/web；`deployment.md` 增补运行说明；ADR-0012。

## 过程中的问题
- `pnpm install` 因 pnpm 12 的 `ERR_PNPM_IGNORED_BUILDS`（@parcel/watcher）失败，改用 `--ignore-scripts`，构建通过。

## 验证（真实输出）
- `docker compose config` 通过；三镜像构建成功；migrate 正常退出，api/web/db 均 Up。
- 学生端：`/`、`/study`、`/login` 200；`/nope` 404；`/` 无 noindex、`/study` 有 noindex；`/api/exams` 200，返回 105 套。
- 管理端：`/`、`/exams` 200；`/api/admin/exams` 无令牌 401。
- 媒体：经 nginx 对真实 N2 mp3 带 `Range: bytes=0-99` 返回 206、100 字节、`audio/mpeg`。
- api 日志无「RESEND_API_KEY 未配置」告警（`backend/.env` 已注入）。

## 未做 / 风险
- 未在容器内用浏览器走完整学习流程、未测管理端登录与容器内真实发信。
- 后端无自动化测试覆盖镜像；未测 `down`/重启后的恢复。
- 无 TLS、备份、日志、restricted DB role；非生产方案。
