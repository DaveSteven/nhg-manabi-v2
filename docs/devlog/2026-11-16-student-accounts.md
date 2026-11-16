# devlog · 2026-11-16 · 学生账户体系（注册/登录）· 后端完成，前端实现完成、测试进行中

## 范围

按 ADR-0011（用户当日确认：邮箱登录、完整邮件流程、30 天 localStorage 会话、scrypt）落地学生注册登录与等级偏好。**本条目为用户暂停会话时的如实快照：后端已完成并全绿；前端代码完成、既有测试与构建全绿；auth 专项前端测试与真实浏览器走查尚未做，整体任务未收尾。**

参考 v1 调查结论（旧项目 `/Users/David/Code/nhg-manabi-project`，只读）：用户名+邮箱+密码、PBKDF2、30 天 opaque token localStorage、Resend 邮件验证/找回、`users.current_level` 双轨。照搬决策与已知问题规避清单见 ADR-0011。

## 已完成

**后端（全部完成，测试通过）**
- Alembic `0007_student_accounts`：`users`（email 唯一、scrypt 哈希、current_level CHECK、activated/disabled、锁定列）、`user_sessions`（token SHA-256、30 天绝对过期、可撤销）、`auth_email_tokens`（verify 24h / reset 1h、一次性）。**测试库已自动迁移；开发库已升级到 0007（已验证 upgrade + 表存在）。**
- `app/passwords.py`：从管理端抽出共享 scrypt 实现；`admin_auth.py` 改为引用（行为不变，其 12 位口令下限保留）。
- `app/student_auth.py`：注册（邮箱小写唯一、口令 8–128、未激活不可登录）、登录（统一 401、5 次失败锁 15 分钟、不存在账号烧等价 scrypt 时间）、登出、verify-email（重放幂等 already）、resend（60s 冷却、统一 200 不泄漏存在性）、forgot/reset（重置后撤销全部会话）、get/update profile。
- `app/emailer.py`：Resend HTTP API；未配 key 时写 `backend/.local/dev-email.log`（dev 模式），发信失败不阻断注册。
- `app/api/auth_student.py`：register/login/logout/verify-email/resend-verification/forgot-password/reset-password + GET/PATCH `/api/me`；字段级错误 400 `{"detail":{field,message}}`；PATCH 方法支持加入前端 client。
- `app/auth.py` 按约定替换：真实会话令牌优先解析，dev_test 仅非生产兜底，fail-closed 不变；作答域端点零改动。
- `docs/development/api-conventions.md` 增补学生认证语义；`deployment.md` 增补邮件三环境变量说明。
- 后端测试：`tests/test_student_auth.py` 15 例新增（注册校验/重复、验证重放与过期、resend 冷却、锁定、重置撤销会话、会话到 /api/me、`get_current_user_id` 真实令牌与 fail-closed）。**全量后端 154 passed + 2 skipped（既有环境性 skip）。**

**前端（代码完成，auth 专项测试与走查未做）**
- `api/authToken.ts`：改为学生会话令牌（`jlptgo.session_token`），`VITE_DEV_USER_TOKEN` 开发覆盖保留。
- `api/endpoints/auth.ts`：8 个端点函数 + zod strictObject DTO（UserProfile/LoginResponse/MeResponse）、`fieldErrorFrom` 解析字段级错误。
- `features/auth/`：`authStore`（localStorage profile + useSyncExternalStore）、`useLevel`（登录读 profile、未登录 localStorage、登录态 PATCH best-effort 双轨）、`HeaderControls`（顶栏右侧等级选择器 + 登录/注册或昵称/退出）。
- 5 个 SPA 路由页 `/login /register /verify-email /forgot-password /reset-password`（noindex、无 study 壳、`_auth.scss` 样式）。
- ExamList：等级偏好一次性种入 URL（replace）；`updateParam` 显式写空值避免偏好回退打架；既有测试查询改为 `getByLabelText("等级", { exact: true })`（顶栏选择器与筛选标签同名）。
- 前端验证：**typecheck 通过；vitest 125 passed（含既有套件，未新增 auth 专项测试）；production build 通过。**

## 尚未完成（下次继续）

1. auth 专项前端测试（store 持久化、useLevel 双轨、HeaderControls 两态、登录/注册/验证页交互、DTO 契约）。
2. 真实浏览器走查：注册→（本地 dev 邮件日志取链接）→验证→登录→等级切换同步→退出→与练习会话的跨账号隔离。**注意：本地已配真实 RESEND_API_KEY（backend/.env），走查时应临时移除该变量改走 dev 邮件日志，避免向真实地址发信。**
3. 8001 端口的后端进程需重启才能加载新的 auth 路由；走查前先重启。
4. 本 devlog 与 progress 更新随本提交入库；整体任务在下一次会话完成后才算收尾。

## 已知风险 / 记录

- 无 IP 级限流（锁定列 + 统一 401 + scrypt 成本为底线），随部署硬化处理（ADR-0011 已记录）。
- iOS Safari 不支持 `background-attachment: fixed`（上条 devlog 遗留，与本次无关）。
- `background` 渐变与顶栏透明化的两个走查遗留项同样未处理（上条 devlog）。
