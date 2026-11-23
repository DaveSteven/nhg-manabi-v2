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

## 补充：管理员、每日备份、预览站点（同日 21:40–21:45）
- 管理员：用户本人在服务器上执行 `admin_cli create-admin`（密码未经过对话）；库中确认 `admin | super_admin | 启用`，管理端公网可打开，错误密码 401。
- 每日备份：`deploy/prod/backup.sh`（装到 `/opt/nhg-manabi-v2/backup.sh`）+ `/etc/cron.d/nhg-manabi-v2-backup`，每天 03:30（服务器时区 JST），自定义格式 `pg_dump`，写入前用 `pg_restore -l` 校验，保留 14 天，日志 `/opt/nhg-manabi-v2/backups/backup.log`。手动运行一次：20 MB。
- 恢复演练：把该备份恢复到临时库 `restore_check`，用户/答案/进度/目录/题目/管理员六项计数与线上库完全一致（7 / 1425 / 1129 / 467 / 14480 / 1），随后已删除临时库。
- 预览站点（仅 127.0.0.1:8180/8181）已移除并 reload nginx；公网 `jpn.manabi.cc`、`/api/exams`、`admin.manabi.cc` 复测均 200。
- 仍待办：用真实 V1 用户登录验证一次、真实邮件与移动端验收、备份异地副本（目前只在同一台服务器上）、观察期后经用户确认再下线 V1 并合并 `main`。

## 补充二：根路径直接进入学习区（用户决定，同日）
- `jpn.manabi.cc/` 现在 302 跳转到 `/study`（nginx `location = / { return 302 /study; }`，未做浏览器缓存的 301，可随时撤回）；`/study`、`/login`、`/api/exams`、`admin.manabi.cc` 复测均 200，带查询串的 `/?x=1` 同样跳转（查询串不保留）。
- 这实际上让品牌首页 `/`（ADR-0007 的静态预渲染页）不再对外可见；页面文件仍在构建产物里。若要恢复，删掉 `deploy/prod/web-locations.inc` 里这一行并重新上传、`nginx -t`、reload。
- 同步改了本地 Docker 的 `deploy/nginx.conf`（未重建本地容器）。

## 补充三：V1 下线（用户决定，2026-11-21 晚；未等满建议的 72 小时观察期）
- 停止 V1 数据库容器 `nhg-manabi-db-1`（V1 API 自 T0 起已停）。V1 两个容器重启策略为 `unless-stopped`，手动停止后服务器重启也不会自动拉起。v2 两个容器、`jpn.manabi.cc`、`admin.manabi.cc` 复测均正常，内存可用约 1.2 GB。
- **保留（均未删除）：** V1 数据卷 `nhg-manabi_postgres`、`/opt/nhg-manabi/`（compose、`.env`、api 源码、`assets` 7 GB、静态 releases）、`/opt/nhg-manabi/backups/`（含 `database-final-v1-20261121T212214.dump`）、V1 nginx 原站点文件（`sites-available`）。V1 的 `assets` 与 v2 媒体是各自独立的副本，可以分别处理。
- 复活 V1（应急）：`ln -sfn /etc/nginx/sites-available/nhg-manabi-web /etc/nginx/sites-enabled/nhg-manabi-web`（admin 同理）→ `nginx -t` → reload；`cd /opt/nhg-manabi && docker compose start db api`。此后 v2 期间产生的数据不会回写 V1。
- 未做：清理 V1 数据卷/素材/目录（建议至少保留数周，并先把备份拉到异地）；**`main` 尚未合并**（需用户明确确认上线验收后执行）。

## 补充四：音频加载失败的排查与修复（同日，用户报告）
- 现象：学生端音频加载失败。v2 API 日志里有 `GET /api/releases/<release>/assets/<asset>` → **404**。
- 根因：v2 媒体接口只服务 `media_storage` 里 `state='stored'` 且哈希匹配的资源；我部署时只把 3887 个文件复制到了 `/opt/nhg-manabi-v2/media` 并核对了哈希，**没有登记 `media_storage`**（线上该表为 0 行，`media_assets` 有 4027 行）。部署时的预览冒烟测试只测了页面、真题列表和登录，**没有覆盖媒体接口**，所以没发现。
- 修复：本地开发库的 `media_storage`（4027 行，均 `stored`，由真实 `media_sync` 用 ffprobe 校验生成；`source_path` 为素材包内的相对路径，不对外）以 `pg_dump --data-only` 同步到线上库，单事务加载成功；文件未改动。
- 验证：失败的音频 `JLPTGO-N2-2026-07-as031` 现在 200 `audio/mpeg`、`accept-ranges`、`Range` 请求 206、`cache-control: immutable`；整文件下载的 SHA-256 与登记的 `stored_sha256` 一致；当前版本里 3226 个带素材的资源随机抽 150 个做 Range 请求，150/150 成功。没有遗漏登记的资源（线上 `media_assets` 与 `media_storage` 一一对应）。
- 上线清单补充（`cutover-plan.md`）：复制/传输媒体后必须登记 `media_storage` 并做媒体接口抽样，作为阶段 B 的验收项。
- 未验证：真实手机/微信内置浏览器上的实际播放与拖动进度（服务端 Range 行为已验证）；严格模考的听力播放规则仍待真实验收。

## 补充五：`main` 合并与 V1 数据删除（用户明确确认，2026-11-21）
- **`main`：** 用户确认上线验收（登录注册已验证、资源已可加载）后，把 `develop` 快进合并到 `main`（`6426552`，此前 `main` 无独有提交，183 个提交）。**仅本地合并，未推送到 origin。**
- **V1 删除范围（用户选择「全部删除，包括备份」，已被告知不可恢复）：** V1 容器与网络、数据库数据卷 `nhg-manabi_postgres`、V1 镜像（`nhg-manabi-api:latest`、`postgres:16`）、整个 `/opt/nhg-manabi/`（api、web、admin、normalized、compose.yml、`.env`、**assets 7 GB**、**backups 456 MB，含 `database-final-v1-20261121T212214.dump` 与历史备份**）。
- 删除前核对：v2 媒体 3887 个文件按「文件名 = SHA-256」复核全部一致；v2 目录无指向 V1 的符号链接、媒体无硬链接；v2 容器只挂载 `/opt/nhg-manabi-v2/media`。删除后 v2 两个容器健康，`jpn.manabi.cc`、`admin.manabi.cc`、`/api/exams` 与媒体接口 Range 请求均正常，磁盘使用从约 22 GB 降到 15 GB。
- **保留：** v2 的全部数据与每日备份（`/opt/nhg-manabi-v2/backups/db/`，同机）、V1 nginx 站点原文件 `/etc/nginx/sites-available/nhg-manabi-{web,admin}`（已不启用，引用的目录已不存在，仅作历史配置，可随时删除）、`/opt/nhg-manabi-v2/backups/nginx-v1-*`（V1 配置副本）。
- **不再可能：** 回滚到 V1。V1 的最终数据现在只存在于 v2 数据库（已导入的用户与作答）；V1 其余原始数据（含 V1 管理员账号、V1 题库表等）已永久删除。
- 风险提醒：v2 备份仍只在同一台服务器上，建议尽快建立异地副本。

## 补充六：加密备份邮件（异地副本，2026-11-23）
- 用户提出定期把备份发到邮箱。风险说明：备份含学生账号、密码哈希与全部学习记录，邮件会留在邮箱和邮件服务商；附件上限（Resend 约 40 MB、Gmail 接收 50 MB）会随数据增长成为瓶颈。因此**先加密再发送**。
- 实现：`deploy/prod/backup_mail.py`（装到 `/opt/nhg-manabi-v2/backup_mail.py`，仅标准库）：取最新 `pg_dump`，用 `openssl enc -aes-256-cbc -pbkdf2 -iter 200000` 与 `/opt/nhg-manabi-v2/backup.key`（600，服务器上随机生成，值从未显示/发送）加密后经 Resend 发附件；加密后超过 25 MB 则只发提醒邮件、不附带，避免静默失败。收件人读取 `.env` 的 `BACKUP_MAIL_TO`，**脚本和仓库里不写任何邮箱地址**。
- 频率：每周日 03:45（`/etc/cron.d/nhg-manabi-v2-backup-mail`，在 03:30 的每日备份之后）；每日备份仍保留在服务器上 14 天。选每周而不是每天，是因为每封约 20 MB，一年约 1 GB。
- 已验证：加密 → 解密往返哈希一致；加密后 20446048 字节，低于 26214400 的限制。
- **尚未发送过一封邮件：** `BACKUP_MAIL_TO` 需要用户自己写进服务器的 `.env`（我的命令因包含账号邮箱被隐私检查拦截）；设置后手动跑一次确认收到。
- 重要：`backup.key` 只在服务器上；**服务器丢失则邮件里的备份无法解密**。用户必须把密钥另存（密码管理器），并保管好。

## 补充七：回退——重新部署 V1，v2 停服（用户决定，2026-11-23）
- 用户指示：「把 V1 部署上去，先把 v2 停掉」。**此时 V1 的服务器数据已在补充五中永久删除**，只能用开发机上的旧资料重建。用户已被明确告知并确认：只能用 **11/14 09:53** 的本地备份，用户在 11/14 之后的作答在 V1 里看不到。
- 数据落差（V1 恢复后 vs 切换时线上数据）：用户 8（含 1 个测试账号；切换时 7）；教材作答 11 条（切换时 79 个练习/638 条）；真题专项作答 65 条（切换时 63 个练习/789 条）——约 98% 的近一周作答不在 V1 中。这些数据仍完整保存在 v2 的数据库里。
- 重建过程（V1 项目源码与 `dist` 未改动）：
  1. 服务器重建 `/opt/nhg-manabi/`：`compose.yml`（取自 `nhg-manabi-api/deploy/compose.yml`）、`api/` 源码、`web`/`admin` 的 11/14 前端构建（与删除前线上版本同一份）、`normalized/`、新随机库口令的 `.env`（`RESEND_API_KEY`/`MAIL_FROM` 在服务器上从 v2 的 `.env` 复制，未显示）。
  2. 数据库：本地最新备份 `database-pre-n2-202307-teacher-rewrite-20261114T095327.dump`（上传后 SHA-256 前 16 位与本地一致）恢复到全新 V1 库：8 用户、1 管理员、106 套真题、10749 题、362 课教材、3618 教材题。
  3. 素材：本地 `exam_assets` 4068 个文件；其中 4032 个按 SHA-256 从 v2 媒体在服务器本地复制，36 个（59 MB）上传；最终 4068/4068 哈希与本地一致。
  4. 切换：`sites-enabled` 两个链接改回 V1 原站点文件（`sites-available` 未被删），`nginx -t` 通过后 reload；停止 v2 的 `api` 容器。**v2 的 `postgres` 容器与数据卷、每日备份、每周备份邮件任务保持运行/保留**。
- 验证：`jpn.manabi.cc` `/`、`/login`、`/api/health`、`admin.manabi.cc` 均 200，页面标题 `JLPT GO!`（V1），`stu.biblenotes.cc` 301 → `jpn.manabi.cc`，错误登录 401；V1 素材接口 Range 206。**未做：** 真实用户登录 V1、手机播放验证。
- 回到 v2：把 `sites-enabled` 链接改回 `/opt/nhg-manabi-v2/nginx/nginx-{web,admin}.conf`，`nginx -t`、reload，`cd /opt/nhg-manabi-v2 && docker compose start api`。v2 数据未受影响；V1 恢复期间若产生新数据，不会同步到 v2。
- 风险：V1 现在是 11/14 的数据；V1 的备份机制没有恢复（新 V1 库没有定期备份）；V1 与 v2 两套库并存占用内存（服务器仅 1.9 GB）。

## 补充八：V1 新库的每日备份（用户确认，2026-11-23）
- `deploy/prod/backup-v1.sh`（装到 `/opt/nhg-manabi/backup.sh`）+ `/etc/cron.d/nhg-manabi-backup`：每天 03:35（JST），`pg_dump -Fc`，写入前用 `pg_restore -l` 校验，保留 14 天，日志 `/opt/nhg-manabi/backups/backup.log`；备份目录 `/opt/nhg-manabi/backups/db/`。
- 手动跑一次 6.9 MB；恢复演练：恢复到临时库后与线上六项计数完全一致（用户 8、管理员 1、真题题目 10749、教材题 3618、教材作答 11、真题作答 65），临时库已删除。
- 仍然只有同机备份；V1 没有配置异地副本（v2 的加密周报邮件任务仍只针对 v2 数据库）。
