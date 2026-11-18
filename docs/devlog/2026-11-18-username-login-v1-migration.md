# 2026-11-18 · 用户名登录与 V1 用户迁移

## 范围
学生账户新增用户名并支持「邮箱或用户名」登录；准备 V1 老用户导入（账号与口令哈希，不含学习记录）。决策见 ADR-0029（取代 ADR-0011 的「无用户名」「不迁移旧用户」）。

## 改动
- 迁移 `0019_username_login`：`users.username`（小写 `[a-z0-9_]{1,64}`、唯一）、`users.legacy_v1_user_id`（唯一）、`email` 可空、CHECK「邮箱与用户名至少一个」、审计 action 加 `user_password_reset`；downgrade 在存在无邮箱用户或重置审计行时拒绝。
- `passwords.py`：识别并校验 V1 `pbkdf2_sha256$salt$hex`（120000 轮，盐按 UTF-8）；登录成功后 `student_auth.login` 把它重哈希为 scrypt。
- 登录接口 `identifier`（含 `@` 为邮箱，否则用户名；旧 `email` 参数兼容）；`/api/me` 与登录响应含 `username`，`email` 可为 null；失败提示改为「账号或密码错误，或账户未验证」。
- 管理端：用户列表/详情显示与搜索用户名；新增「重置密码」（一次性临时口令，撤销会话，审计）；Dashboard 邮箱排除规则对 NULL 邮箱安全（否则无邮箱用户会被当作无效用户）。
- `app/v1_user_import.py`：默认 dry-run、按 `legacy_v1_user_id` 幂等、冲突与不合规逐条报告、不改名。
- 学生端登录框改为「邮箱或用户名」，个人中心对无邮箱账号显示用户名。

## 决策与说明
- 生产账户不随部署迁移；部署只改表结构，导入是部署后单独授权的步骤（见 ADR-0029「上线步骤」）。
- V1 的 `App/manabi_api`（iOS 用，已废弃）不迁移。用户确认存量用户名均为小写；脚本仍对不合规用户名做报告而不静默改名。
- 无邮箱账号没有自助找回，由管理员重置；绑定邮箱、自助改用户名、注册时设用户名均未做。

## 测试（真实本地 PG 测试库）
- 后端 `pytest -q`：298 passed, 2 skipped（含新增 `test_username_login.py` 11 项：V1 哈希校验与升级、用户名/邮箱/旧参数登录、无邮箱账号、跨标识符锁定、DB 约束、管理员重置、Dashboard NULL 邮箱、导入 dry-run/幂等/冲突报告）。
- 测试库 `alembic downgrade 0018_admin_audit_logs` → `upgrade head` 成功。
- 学生端 `vitest run`：40 文件 348 passed；`tsc --noEmit` 通过。
- 管理端 `npm test`：51 passed；`tsc`、eslint（users 与 api）、`npm run build` 通过。

## 未执行 / 风险
- 未对真实 V1 库运行导入（需用户授权），未验证 V1 实际数据中的无效用户名、邮箱重复与空哈希比例。
- 未升级开发库（55432）与生产；downgrade 的「拒绝」分支未用数据测试。
- 未做真实浏览器验收；V1 与 v2 并行期间口令不同步。
- 未做 IP 级限流（沿用 ADR-0011 已知风险）。
