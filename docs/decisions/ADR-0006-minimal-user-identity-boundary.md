# ADR-0006：M2 最小用户身份边界

- 状态：已采用（M2.1 Task 03 落地）
- 日期：2026-11-16

## 决定

1. **`user_id` 一律由服务端认证上下文解析**（`app/auth.py` 的 `get_current_user_id` FastAPI 依赖）：任何作答域端点都不接受客户端传入的 `user_id` 作为身份。会话/草稿/提交的读写都按解析出的身份过滤。
2. **默认 fail-closed**：未显式配置认证机制（`AUTH_MODE`）时，所有需要身份的请求一律 401。生产环境不存在宽松缺省。
3. **唯一已实现的机制是开发/测试身份（`AUTH_MODE=dev_test`）**：Bearer token 即用户 UUID，且必须列于 `DEV_TEST_USER_IDS` 环境变量；`APP_ENV=production` 时该机制无条件失效（硬禁用，不依赖部署纪律）。完整邮箱注册、密码找回等不在 M2 范围。
4. **暂不建 users 表**：Schema v0.2 的 `study_sessions.user_id` 本就是无外键的不透明 UUID；最小边界只需要「服务端可解析、不可伪造」的标识。将来接入正式认证时只替换 `get_current_user_id` 的实现，端点签名不变。
5. **跨账号隔离语义**：访问他人会话与访问不存在的会话返回相同的 404，不泄漏会话存在性。

## 理由

作答记录必须归属可验证身份（AGENTS.md 产品红线 + M2 计划 Task 03），但完整账户体系是后续里程碑。若以「客户端传 user_id」过渡，后续接入认证时所有历史数据与端点语义都要返工，且无法防止伪造身份读写他人会话。fail-closed + 环境变量硬门保证测试身份机制不可能误用于生产。

## 影响

- `app/api/practice.py` 及后续作答端点统一 `Depends(get_current_user_id)`；认证实现演进时只改 `app/auth.py`。
- `AUTH_MODE=dev_test` 与 `DEV_TEST_USER_IDS` 仅用于本地/测试部署文档；生产部署清单必须不含这两个变量（且 `APP_ENV=production` 为双保险）。
- 无数据库迁移；将来正式 users 表落地时另立 Alembic revision 并可回填历史 `user_id` 映射。
- 更改本决策须同步 `docs/development/api-conventions.md`（401/403/404 语义）与 `test_auth.py`。
