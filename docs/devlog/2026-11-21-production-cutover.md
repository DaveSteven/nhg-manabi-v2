# 2026-11-21 · v2 生产上线（替换 V1）

## 范围
用户指示：「停掉 V1，直接部署 V2」（ADR-0031）。在 V1 所在服务器（`ssh manabi`）部署 v2，导入 V1 用户与作答，把 `jpn.manabi.cc` / `admin.manabi.cc` 切到 v2。发布提交 `d4588c8`（构建时的 `develop` HEAD，工作区干净）。**未合并 `main`**（待用户验收确认）。

## 过程与结果
1. 前端本地构建（学生端 `npm run build`、管理端 `npm run build`，均通过）；API 镜像在**服务器上**用后端源码构建（`nhg-manabi-v2-api:d4588c8`，36 秒）——网络慢，未传镜像。
2. 服务器新建 `/opt/nhg-manabi-v2/`（独立目录与 Compose 项目 `nhg-manabi-v2`：postgres 不发布端口、migrate、api `127.0.0.1:8102`；不跑 web 容器，宿主 nginx 提供静态文件）。`.env`（600）在服务器上生成：随机库口令，`APP_ENV=production`、`PUBLISH_POLICY=auto`、`APP_BASE_URL=https://jpn.manabi.cc`，`RESEND_API_KEY`/`MAIL_FROM` 在服务器上从 V1 的 `.env` 复制（未显示值）。**无 `AUTH_MODE=dev_test`。**
3. 媒体：直接 rsync 约 2 MB/s，用户要求停止上传后，改为按 **SHA-256 在服务器本地复制 V1 素材**——v2 的 3887 个媒体文件（7.30 GB）内容 100% 存在于 V1 `assets`；复制 53 秒；全量哈希复核发现 1 个文件是被中止上传留下的残缺文件（2.52 MB/应 2.66 MB），已重传，最终 3887/3887 哈希一致。
4. 迁移到 `0020_supplementary_exams`；`api` 健康。导入内容（容器内运行）：真题 108 包 → 105 套；扩展练习 362 课（由 V1 线上只读转换，3618 题、2 处人工修订、0 排除、0 待复核）。媒体资源 4027 个均为 `verified`。
5. 仅监听 127.0.0.1 的预览站点（经 `ssh -L`）冒烟：学生端/管理端 200、真题列表 105 且不含扩展课、未登录扩展练习接口 401、错误登录 401。
6. T0（2026-11-21 21:22）：停止 V1 `api`（数据库保持运行），V1 数据库最终备份 `/opt/nhg-manabi/backups/database-final-v1-20261121T212214.dump`（6.8 MB，`pg_restore -l` 可读，291 项）；V1 nginx 站点配置副本在 `/opt/nhg-manabi-v2/backups/nginx-v1-20261121T212214/`。
7. 导入（先 dry-run 校验，条件全满足才 apply）：用户 7（无邮箱 7、0 冲突）；教材作答 79 会话/638 作答，0 跳过、0 改判；真题作答 63 会话/789 作答中 787 导入、2 条因 `needs_review` Unit 跳过、0 改判。库内核对：142 会话、1425 正式答案、进度表 1129 行、7 用户均带 V1 标识。
8. 切换：`sites-enabled/nhg-manabi-web|admin` 两个符号链接改指 v2 站点文件（V1 的 `sites-available` 原文件未改），`nginx -t` 通过后 reload。公网验证：`jpn.manabi.cc` `/`、`/study`、`/login`、`/api/exams` 与 `admin.manabi.cc` 均 200；`/api/exams` 105 套、无扩展课泄漏；`stu.biblenotes.cc` 仍 301 → `jpn.manabi.cc`；错误登录 401。API 日志无 error；内存可用约 1.2 GB。

## 仓库内新增
`deploy/prod/`（`compose.yml`、`nginx-web.conf`、`nginx-admin.conf`、`nginx-preview.conf`、两个 `*-locations.inc`、`README.md`）。

## 回滚方式（未使用）
`ln -sfn /etc/nginx/sites-available/nhg-manabi-web /etc/nginx/sites-enabled/nhg-manabi-web`（admin 同理）→ `nginx -t` → reload → 在 `/opt/nhg-manabi` 执行 `docker compose start api`。V1 数据库未被改动；切换后在 v2 产生的数据不会回写 V1。

## 未执行 / 风险 / 待办
- **管理员账号尚未创建**（需用户本人输入密码）：`ssh -t manabi 'cd /opt/nhg-manabi-v2 && docker compose exec api python -m app.admin_cli create-admin <用户名>'`。
- 未能用真实 V1 用户登录验证（不知道其口令）；V1 用户首次登录会自动把 PBKDF2 哈希升级为 scrypt，需用户或管理员协助验证一次；忘记密码由管理端「重置密码」处理。
- 未验证：真实邮件发送、移动端与其他浏览器、媒体真实播放、v2 数据库每日备份（**尚未配置**）。
- 预览站点 `nhg-manabi-v2-preview`（仅 127.0.0.1）仍启用，可按需移除。
- V1 容器 `nhg-manabi-api-1` 已停止、`db` 仍在运行；观察期（建议 72 小时）后由用户确认再下线 V1，并合并 `main`。
- 3618 道扩展题与真题答案仍为 unverified，扩展题无解析。
