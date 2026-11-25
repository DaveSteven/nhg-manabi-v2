# 2026-11-25 线上前端不再需要强刷

- 现象：发版后用户要强制刷新才看到新前端。
- 排查：打包文件名已带内容哈希（如 `ReadingSizeControl-DqW3kETX.js`），`/assets/` 为 `max-age=31536000, immutable`，这部分没问题。问题在 HTML 入口（`/study` → `__spa-fallback.html`、`index.html`）：响应只有 `Last-Modified`/`ETag`、没有 `Cache-Control`，浏览器按启发式缓存，继续使用引用旧哈希文件的旧页面。
- 改动：`deploy/prod/web-locations.inc`（SPA 路由与 `/`）、`admin-locations.inc`（`/`）给 HTML 加 `Cache-Control: no-cache`（每次用 ETag 再验证，未变化返回 304，开销很小），并重复 server 级安全头（location 内的 `add_header` 会覆盖 server 级）。新增 `deploy/prod/release-frontend.sh`：发布新 release 时把旧 release 的 `assets` 合并进来，避免仍开着旧页面的用户懒加载旧 chunk 时 404；线上两个当前 release 已做同样合并（web 128、admin 31 个文件）。
- 验证：服务器 `nginx -t` 通过并 reload；curl 看到 `/study`、`/study/exams`、`/mock/x`、`/login`、admin `/`、`/favicon.svg` 均为 `no-cache` 且安全头齐全，`/assets/*.js` 仍为 `immutable`。**未做：** 真实浏览器验证；已经缓存了旧 HTML 的浏览器需再手动刷新一次才会取到新规则。
- 未改：本地 Docker 的 `deploy/nginx.conf`。
