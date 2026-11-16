# devlog · 2026-11-16 · 学生账户体系（注册/登录）· 完成

> 状态更新（同日晚间续）：本条目上半部分为会话暂停时的快照；**任务现已全部完成**，见文末「续：完成情况」。

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

（已全部完成，见下节。）

## 续：完成情况（同日晚间）

1. **auth 专项前端测试**：`features/auth/auth.test.tsx` 14 例（store 持久化与订阅、useLevel 访客/登录双轨与 PATCH 失败容错、HeaderControls 两态、登录/注册/验证/找回/重置五个页面交互含字段级错误映射、`fieldErrorFrom`）。**前端全量 17 文件 / 139 passed**；typecheck、production build 通过。
2. **真实浏览器走查（真实 Chrome + 真实 uvicorn:8001 + 开发库；后端进程临时移除 RESEND_API_KEY，邮件走 `backend/.local/dev-email.log`，未发任何真实邮件）**，全部通过：注册→取验证链接→激活→同链接重放幂等（already）→未验证登录被统一 401 文案拒绝→登录→顶栏显示昵称→等级切 N1→刷新后会话与等级保持（服务端核验 `users.current_level='N1'`）→退出→刷新仍为登出（会话 revoked，DB 核验）；试卷目录偏好种子（干净访问种入 `?level=N1`）、显式「全部」(`?level=`) 刷新后不再被重种（见下）。
3. 走查抓到并修复 **3 个真实缺陷**：
   - `VerifyEmailPage` effect 被 React Router 默认 `entry.client.tsx` 的 `<StrictMode>` 双触发：第一次消费令牌返回 ok、第二次返回 already；后被 alive-flag 与单发守卫组合卡死在「验证中」。修复：per-token 单发守卫 + 去掉 alive 标志（StrictMode cleanup 不吞唯一在途请求）。
   - sticky 头部 `pointer-events:none` 穿透后，恢复选择器仍写旧类名 `.header-controls`，新组件 `.header-controls-inner` 继承 none，「退出」按钮不可点击。修复选择器。
   - ExamList 偏好种子判断 `!params.get("level")` 把显式空值（`?level=`=全部）当未选择，刷新被重种回偏好等级；改严格 `=== null` 判断，并补「种子一次 + 全部存活」回归测试。
4. **用户新决定（2026-11-16）：等级选择器仅登录后显示**（访客不显示）。`HeaderControls` 按登录态渲染；测试覆盖访客无选择器/登录显示两态；真实浏览器确认访客顶栏无选择器。
5. 8001 后端以新代码重启验证（auth 路由生效）；走查完成后两台 dev server 已停止。

## 测试（真实结果，续）

- 后端全量：**154 passed + 2 skipped**（环境性 skip，与本次无关）。
- 前端全量：**17 文件 / 139 passed**（新增 14 例 auth + 1 例 ExamList 种子回归）。
- `pnpm typecheck`、`pnpm build`（含 SSG/SPA 产物与凭据泄漏检查）：通过。
- 服务端 DB 核验：走查用户 `current_level='N1'`、未验证账户 `activated_at NULL`、logout 后 `user_sessions.revoked_at` 非空。
- `backend/.local/dev-email.log` 确认 gitignored，未提交。

## 已知风险 / 记录

- 无 IP 级限流（锁定列 + 统一 401 + scrypt 成本为底线），随部署硬化处理（ADR-0011 已记录）。
- 生产部署必须配置 `RESEND_API_KEY`/`MAIL_FROM`/`APP_BASE_URL`，否则用户收不到验证/重置邮件（本地走 dev 日志）。
- React Router 默认入口带 StrictMode：今后写「只应执行一次」的 effect 必须做防重触发（见 VerifyEmailPage 修复注释）。
- iOS Safari 不支持 `background-attachment: fixed`（上一条 devlog 遗留，与本次无关）。
