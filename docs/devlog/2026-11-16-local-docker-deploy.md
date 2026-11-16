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

## 容器内浏览器验证（同日续，内置浏览器，对容器 :8080/:8081）
- 管理端：真实登录 → 试卷管理页显示 105 套、已发布 105（首次点击坐标偏差未发出登录请求，改用元素引用后成功）。
- 学生端：测试学生由 `student_auth.register/verify_email` 在 api 容器内直接创建（避免向 example.test 真实发信；账号留在开发库，口令在被忽略的 `.local/docker-e2e-student.txt`）。登录 → `/study` → 试卷列表（N5 6 套）→ 试卷大纲 → 开始练习 → 选择答案（自动保存「已保存」）→ **刷新后草稿仍在** → 提交 → 服务端判题，提交后才出现解析 → 完成练习 → 结果页（错误 1，得分率 0%）。
- 仅有的 404 是无活跃会话时的 `/practice/sessions/current`，符合预期。
- 复现已知文案问题：提交确认框在 0 道未答时仍显示「本次有 0 道题未作答」。

## 未做 / 风险
- 听力音频出声/拖动、多题型、统一反馈模式、容器内真实发信未验证（媒体 Range 仅做了 HTTP 级验证）。
- 未在容器内用浏览器走完整学习流程、未测管理端登录与容器内真实发信。
- 后端无自动化测试覆盖镜像；未测 `down`/重启后的恢复。
- 无 TLS、备份、日志、restricted DB role；非生产方案。
