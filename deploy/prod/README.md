# 生产部署文件（ADR-0031，计划见 docs/development/cutover-plan.md）

服务器目录 `/opt/nhg-manabi-v2/`：`compose.yml`、`.env`（600，不入 Git）、`media/`、
`web|admin/releases/<时间戳>` + `current`、`nginx/`（本目录的 `*.conf`、`*.inc`）、`backups/`。

`.env` 需要：`POSTGRES_USER/PASSWORD/DB`、`IMAGE_TAG`、`APP_ENV=production`、
`PUBLISH_POLICY`、`APP_BASE_URL=https://jpn.manabi.cc`、`RESEND_API_KEY`、`MAIL_FROM`。
**不得设置 `AUTH_MODE=dev_test`。**

nginx：`nginx-preview.conf` 仅监听 127.0.0.1；`nginx-web.conf` / `nginx-admin.conf` 是切换时才启用的正式站点（先备份并替换 V1 的同名 server_name 站点）。

前端发布：`deploy/prod/release-frontend.sh web|admin`（先本地构建）。HTML 入口由 nginx 以 `Cache-Control: no-cache` 提供（ETag 再验证），`/assets/` 带内容哈希、`immutable` 一年；脚本把旧 release 的 assets 合并进新 release，避免仍开着旧页面的用户懒加载旧 chunk 时 404。
