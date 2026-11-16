# ADR-0011：学生账户体系与正式认证

- 状态：已采用（2026-11-16 用户确认四项决策后落地）
- 日期：2026-11-16
- 关联：ADR-0006（最小身份边界，本 ADR 替换其实现）、ADR-0009（管理端身份，模式对齐）

## 决定

按用户 2026-11-16 明确确认：

1. **登录标识为邮箱**（不引入用户名）：注册 = 邮箱 + 密码 + 可选昵称；邮箱小写化存储、全表唯一。规避 v1 用户名大小写匹配隐患；找回密码只依赖邮箱。
2. **首版即做完整邮件流程**（v1 同款 Resend HTTP API）：邮箱验证（注册后未激活不可登录，验证链接 24h）与找回密码（重置链接 1h，令牌一次性，重置成功撤销全部会话）。`RESEND_API_KEY`/`MAIL_FROM`/`APP_BASE_URL` 为部署配置；未配置发信密钥时（本地开发）验证/重置链接写入 `.local/dev-email.log`，注册不因发信失败回滚。发信相关端点对账号不存在/已激活等状态返回统一口径，不泄漏账号存在性。
3. **会话为不透明 Bearer 令牌，30 天绝对有效期，前端存 localStorage**：库内只存 SHA-256；无刷新/滑动续期（过期重登，与 v1 一致）。接受与 v1 同级的 XSS 长会话风险，记录在案。
4. **口令哈希用 scrypt**（与 ADR-0009 管理端同一实现，`app/admin_auth.py` 抽取共用），不沿用 v1 PBKDF2-120k。学生口令最低 8 位（管理端 12 位更严，保持不动）。登录失败 5 次锁 15 分钟（列级锁定，失败计数在事务外提交，与管理端同语义），失败一律统一 401，不存在的账号烧等价 scrypt 时间。

## 结构

- Alembic `0007_student_accounts`：`users`（email、display_name、password_hash、`current_level` CHECK N5–N1 默认 N5、activated_at/disabled_at、锁定列）、`user_sessions`（token_hash 唯一、绝对过期、可撤销）、`auth_email_tokens`（purpose verify|reset、过期、一次性 used_at）。学生与管理员身份空间继续完全分离。
- `app/auth.py` 的 `get_current_user_id` 按约定替换实现：Bearer 令牌先查 `user_sessions`；未命中且 `AUTH_MODE=dev_test`（非生产）才走测试身份；两者皆未命中 401（fail-closed 语义不变）。端点签名不变，作答域无感知。
- 新增 `app/api/auth_student.py`：`POST /api/auth/register|login|logout|verify-email|resend-verification|forgot-password|reset-password`、`GET /api/me`、`PATCH /api/me`（display_name、current_level）。
- **等级偏好双轨**（参考 v1）：已登录存 `users.current_level`（`PATCH /api/me`）；未登录存 localStorage；前端本地即时生效、服务端 best-effort 同步。
- 限流不照搬 v1 的进程内存计数器：注册/登录爆破防护首版以「锁定列 + 统一 401 + scrypt 成本」为底线；IP 级限流随部署硬化另行处理（记录为已知风险）。
- 不迁移 v1 旧用户（决策保持「旧用户迁移未定稿」，不在本 ADR 范围）。

## 影响

- `docs/development/api-conventions.md` 增补学生认证语义（401 统一口径、`/api/auth/*`、`/api/me`）；部署文档增补三个邮件环境变量。
- `AUTH_MODE=dev_test` 与 `DEV_TEST_USER_IDS` 语义不变，仍生产硬禁用；开发环境可与真实会话共存（真实令牌优先）。
- 前端 `getBearerToken` 改读学生会话令牌（localStorage），`VITE_DEV_USER_TOKEN` 开发覆盖保留。
- 未激活/停用账号不可登录；停用即撤销全部会话。
