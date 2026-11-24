# 2026-11-24 停 V1、重新部署 v2，并补同步 V1 练习数据

## 范围
用户指示：「停掉 V1，部署 V2 到服务器，部署之前把 V1 的练习数据再同步一遍」。承接 11/23 的回退（补充七）：V1 当时用 11/14 备份重建并对外服务，期间产生了新作答。部署提交 `b98434a`（`develop`，**未合并 `main`**，待用户确认上线验收）。

## 发现的问题（同步前必须处理）
1. **V1 重建后作答编号被重新发放**：重建的 V1 从 11/14 备份恢复，attempt 编号 14–33（教材）/ 14–23（真题）是新作答，却与之前已导入 v2 的旧作答编号相同；原导入脚本只按编号判重，会把新作答全部当成“已导入”跳过。改为按 `(attempt id, created_at)` 判重。
2. **用户 id 不一致**：重建的 V1 里同名用户的 UUID 与 11/21 导入时不同，`legacy_v1_user_id` 全部对不上（33 个教材 + 23 个真题作答全被判 `user_not_imported`）。新增 `--match-users-by-username`：id 对不上时按用户名映射，仅限 v2 中带 V1 标识的账号。
3. **备份里混有开发期数据**：重建的 V1 里 11/12–13 的作答来自开发机而非线上，不是 v2 已有数据的子集。新增 `--since`，只同步 V1 重新上线（11/23 02:09 UTC）之后产生的作答，避免重复/污染。
4. 教材题 id 对应性抽查：249 道有作答的题，231 道首句文字与 v2 映射题一致，其余 18 道均以【】开头（抽查法对它们不适用），未发现不一致；导入本身还会按答案位置校验（0 改判）。

## 过程
1. 本地：后端 338 passed + 2 skipped；web/admin 构建通过；服务器上用 `-f backend/Dockerfile` 在 `/opt/nhg-manabi-v2/src` 构建镜像 `nhg-manabi-v2-api:b98434a`；web/admin 上传为 `releases/<时间戳>`，`current` 暂未切换。
2. T0（23:39 JST）：备份 v2 库（`backups/cutover/v2-before-cutover-*.dump`，pg_restore 可读）、停 V1 `api`、导出 V1 最终备份（`/opt/nhg-manabi/backups/database-final-v1-20261124T233934.dump`）、复制 `sites-available`。
3. 经 ssh 隧道 dry-run → apply：教材 31 会话/268 作答、真题 10 会话/74 作答（2 条 `unit_not_practicable` 跳过），0 改判；再跑一遍全部 `already_imported`，0 新增。库内：导入会话共 183（原 142 + 41），正式答案 1774。
4. v2：`IMAGE_TAG=b98434a`，迁移到 `0021_question_type_labels_zh`，api 健康。
5. 切换（约 23:47）：`current` 指向新 release，两个 `sites-enabled` 链接改回 v2 站点文件，`nginx -t` 通过后 reload。公网验证：`/study`、`/login`、`/api/exams`（105 套）、`admin.manabi.cc` 200，`/` 302 → `/study`，错误登录 401，`stu.biblenotes.cc` 301，音频 Range 请求 206；新前端包含「字号设置」；API 日志无 error，内存可用约 1.2 GB。
6. V1 `db` 容器随后停止（restart 策略 `unless-stopped`，手动停止不会被自动拉起）。

## 回滚方式（未使用）
`ln -sfn /etc/nginx/sites-available/nhg-manabi-web /etc/nginx/sites-enabled/nhg-manabi-web`（admin 同理）→ `nginx -t` → reload；`cd /opt/nhg-manabi && docker compose start db api`。回滚后，v2 期间产生的数据不回写 V1。

## 未执行 / 风险
- 未用真实用户登录验证；未做移动端、真实邮件、浏览器端到端验收；`main` 未合并。
- V1 的每日备份 cron（`/etc/cron.d/nhg-manabi-backup`，03:35）仍在，V1 库已停，会每天报错，需用户决定删除。
- V1 重建库里 11/12–13 的开发期作答（教材 2 个、真题 13 个）有意未导入。
- 备份仍只有同机副本，没有异地副本。
