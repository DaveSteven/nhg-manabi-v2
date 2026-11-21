# v2 上线与 V1 迁移计划（草案 v2，待用户确认）

> 状态：**计划，未执行。** 目标已定（ADR-0031）：**在 V1 所在服务器上，用 v2 替换 V1，v2 成为正式版本。** 每个带 ⚠ 的步骤都是外部动作，需要用户明确授权后才执行。服务器现状来自 2026-11-21 的只读查看（未改动任何东西）。

## 1. 目标环境（只读查看所得）

| 项目 | 现状 |
|---|---|
| 主机 | `ssh manabi`；Ubuntu 24.04，x86_64，3 核，**内存 1.9 GB（可用约 1.2 GB）**，swap 2 GB，磁盘剩余 79 GB |
| V1 运行 | Docker Compose 项目 `nhg-manabi`：`api`（`127.0.0.1:8002`）+ `db`（postgres:16，卷 `nhg-manabi_postgres`）；目录 `/opt/nhg-manabi/`（`compose.yml`、`.env`、`api/`、`assets/` 7 GB、`backups/`、`web/` 与 `admin/` 的 `releases/<时间戳>` + `current` 软链） |
| 入口 | 宿主 nginx 终止 80/443：`/etc/nginx/sites-enabled/nhg-manabi-web`（`jpn.manabi.cc` + `stu.biblenotes.cc` 跳转）、`nhg-manabi-admin`（`admin.manabi.cc`）；静态根 `…/current`，`/api/` 反代 `127.0.0.1:8002`；证书为 Let's Encrypt（`/etc/letsencrypt/live/…`） |
| 备份 | `/opt/nhg-manabi/backups/` 已有 V1 的 `pg_dump` 备份 |
| 部署习惯 | V1 的 `deploy.sh`：先备份数据库 → rsync 源码 → `docker compose up -d --build` → 健康检查；前端以时间戳目录发布并切 `current` |

## 2. 目标拓扑（v2）

- 目录 `/opt/nhg-manabi-v2/`（独立于 V1）：`compose.yml`、`.env`（权限 600）、`media/`（约 6.8 GB，只读挂载到 API）、`web/releases/<时间戳>` + `current`、`admin/releases/…` + `current`、`backups/`、`nginx/`（待启用的站点文件）。
- Compose 项目 `nhg-manabi-v2`：`postgres`（**不发布端口**，独立卷 `nhg_manabi_v2_pgdata`）、`migrate`、`api`（`127.0.0.1:8102`）。**不跑 `web` 容器**——前端静态文件由宿主 nginx 提供，与 V1 一致，省内存。
- nginx：新增 `nhg-manabi-v2-web` / `-admin` 站点文件（同样的 `server_name`、证书，`root` 指 v2 的 `current`，`/api/` 反代 `127.0.0.1:8102`，SPA 回退规则同 `deploy/nginx.conf`）。**准备好但不启用**；切换时才替换 V1 的站点文件。另有仅监听 `127.0.0.1` 的预览站点（学生端 `:8180`、管理端 `:8181`），通过 `ssh -L` 访问，不对外。
- 构建在开发机完成：API 镜像交叉构建为 `linux/amd64`（`docker buildx`），`docker save | ssh manabi docker load`；前端在本地构建后 rsync 为新 release 目录。服务器不编译。
- 环境变量（生产）：强随机数据库口令；`APP_ENV=production`（**不得设置 `AUTH_MODE=dev_test`**）；`PUBLISH_POLICY`；`MEDIA_STORAGE_DIR=/srv/media`；`APP_BASE_URL=https://jpn.manabi.cc`；`RESEND_API_KEY`、`MAIL_FROM`（由用户提供）。

## 3. 待用户决定（剩余）

| # | 事项 | 说明 |
|---|---|---|
| ~~D1~~ | ~~部署目标~~ | **已定：本服务器，替换 V1，沿用现有域名（ADR-0031）** |
| D2 | 邮件：`RESEND_API_KEY`、`MAIL_FROM` | 缺则新注册用户收不到验证邮件；V1 的 7 个用户都无邮箱，登录不受影响 |
| D4 | 时间窗口 | 冻结 V1 的日期时间、预计停机时长（见 §4 阶段 C，约 15–30 分钟）、如何通知 7 位用户 |
| D5 | 管理员账号 | 生产用 `admin_cli` 新建（V1 管理员不迁移） |
| D6 | 展示名「扩展练习」；`auto` 策略下未核对答案直接发布 | ADR-0030 待确认 |
| D7 | 无邮箱用户的找回方式 | 管理端「重置密码」 |
| D8 | 旧链接 | V1 前端旧路由失效；是否在 nginx 加跳转 |
| D9 | V1 下线时间 | 观察期（建议 72 小时）后 V1 数据库保留多久、何时清理 |

## 4. 步骤

### 阶段 A：准备（不动服务器上任何现有东西）
1. 选定要上线的 `develop` 提交并记录 commit ID；`pytest`、web/admin 测试、`tsc`、构建全部通过。
2. 开发机构建：API 镜像（amd64）、学生端与管理端静态包；生成 `compose.yml`、`.env` 模板、nginx 站点文件，**先在本地 Docker 完整演练**（含迁移、导入、回滚）。
3. ⚠ 在服务器创建 `/opt/nhg-manabi-v2/` 并传输：镜像、前端 release、`compose.yml`、`.env`、`data/v2-media`（rsync，核对文件数与大小/SHA-256）。**此时 V1 照常运行、不受任何影响。**

### 阶段 B：v2 并存部署（V1 仍是对外入口）
4. ⚠ `docker compose -p nhg-manabi-v2 up -d postgres` → `migrate`（0001→0020）。检查：迁移版本 `0020_supplementary_exams`；`SELECT 1`。
5. ⚠ 导入内容：真题 108 个包（`python -m app.importer`，应得 105 套已发布、`mojitest` 映射 10647）；扩展练习 362 课（`app.v1_book_convert` 转换 → `app.importer`；3618 题、0 隐藏 Unit）。导入工具在开发机运行，经 `ssh -L` 连 v2 数据库（v2 库无公网端口）。
6. ⚠ 创建管理员；启动 `api`；启用仅本机的预览站点；经 `ssh -L` 在浏览器里走：登录、真题列表、一套真题与一课扩展练习的完整作答（用测试账号，结束后删除）、管理端。**V1 与 v2 并存期间用 `free -h` 观察内存。**

### 阶段 C：冻结 V1 → 迁移 → 切换（有停机窗口，约 15–30 分钟）
7. ⚠ T0：把 V1 站点换成维护页（nginx 仅返回 503 页面）并停止 V1 `api`（`docker compose stop api`，**`db` 保持运行**，供只读导出）。记录 T0。
8. 备份 V1 库（`pg_dump`，写入 `/opt/nhg-manabi/backups/`，只读操作）与 nginx 配置副本。
9. ⚠ 导入（均先 dry-run 核对数字，再 `--apply`；V1 以只读事务读取）：用户（预期 7 人、无邮箱 7、0 冲突）→ 教材作答（预期 0 跳过、0 改判）→ 真题作答（预期仅 `needs_review` Unit 的少量跳过、0 改判）。**数字以 T0 之后的最终数据为准**，与上次 dry-run 差异需解释；核对 V1 错题本与导入后仍错集合。
10. 抽样验收（经预览站点）：用 V1 用户名 + 原密码登录成功且哈希升级为 scrypt；「我的学习」覆盖率/仍错合理；扩展练习课程进度；管理端看到 7 个用户。用户忘记密码的由管理员重置。**任一项失败 → 停止，走 §5 回滚，不切换。**
11. ⚠ 切换：启用 v2 的 nginx 站点文件替换 V1 站点（先备份旧文件）→ `nginx -t` → `systemctl reload nginx`。验证：`https://jpn.manabi.cc` 与 `https://admin.manabi.cc` 返回 v2，`/api/health`、`/api/exams`（105 套）正常，`stu.biblenotes.cc` 仍跳转。

### 阶段 D：观察与收尾
12. 观察 72 小时：登录失败率、API 5xx、迁移用户首次登录、内存与磁盘、管理端 Dashboard、数据库备份（为 v2 设置每日 `pg_dump` 并验证可恢复）。V1 容器保持停止、数据保留。
13. 观察期满、验收完成后，**由用户明确确认**：① 把对应 `develop` 状态合并到 `main`（AGENTS：`main` 只代表已成功上线）；② 按 D9 下线 V1（停止 `db`、保留备份与卷若干天后再清理）。
14. 在 `docs/devlog/` 为这次上线新增日志：commit ID、每步命令与真实输出、核对结果、未执行项。

## 5. 回滚

| 时点 | 做法 |
|---|---|
| 阶段 A、B | v2 是独立新环境，停止/删除 `/opt/nhg-manabi-v2` 即可，V1 完全不受影响 |
| 阶段 C 第 7–10 步失败（尚未切换） | 恢复 V1 站点文件（保持原样）、`docker compose start api`，V1 恢复；v2 库可丢弃重导。导入只读 V1，V1 数据未被改动 |
| 阶段 C 第 11 步后、观察期内出现严重问题 | nginx 站点文件换回 V1 副本并 reload，`docker compose start api`；**在 v2 期间产生的新数据不会回写 V1**，需用户决定放弃或事后补迁 |
| 观察期满并下线 V1 之后 | 只能从备份恢复 V1，不再作为日常回滚手段 |

迁移 0019/0020 的 downgrade 遇到无邮箱用户或扩展课会拒绝执行，回滚用「恢复备份」，不靠 downgrade。

## 6. 风险

1. **内存只有 1.9 GB**：并存期间 V1（api+db）与 v2（api+db）同时运行；阶段 B 要盯 `free -h`，必要时在窗口前停掉 V1 之外的无关进程；不在服务器上构建。
2. 生产 HTTPS/邮件真实发送、媒体上传后的真实播放、移动端与其他浏览器均未演练；v2 在生产环境从未运行过。
3. 3618 道扩展题和真题答案均 `unverified`，扩展题无解析；`auto` 策略直接对用户开放（D6）。
4. 7 个 V1 用户无邮箱，忘记密码只能管理员重置；没有绑定邮箱与自助改用户名入口。
5. 切换后 V1 与 v2 数据不再同步；V1 还在增长（需以 T0 后的最终数据为准）。
6. 管理端学习活跃/作答统计会包含导入的 V1 作答；真题作答不进「练习历史」。
7. 未做 IP 级限流；严格模考的时间/音频规则仍待真实验收；V1 旧路由失效。

## 7. 授权清单（逐项）

不会自动执行任何外部动作。每个 ⚠ 步骤执行前，在对话里向你说明将要做什么、影响范围和回退方式，得到明确同意后才执行：创建服务器目录并传输文件（3）、启动 v2 数据库与迁移（4）、导入内容（5）、创建管理员并启动 API/预览（6）、冻结 V1 与维护页（7）、三项数据导入（9）、nginx 切换（11）、合并 `main` 与下线 V1（13）。
