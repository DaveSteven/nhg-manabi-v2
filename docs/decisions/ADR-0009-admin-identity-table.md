# ADR-0009：管理员使用独立的管理员表与会话

- 状态：已采用（用户 2026-11-16 要求"管理员需要单独的管理员表"）
- 日期：2026-11-16
- **修订：ADR-0010 把角色收窄为单一 `super_admin`（下文第 3 条三级角色暂缓）。**
- 补充：ADR-0006（学生最小身份边界）、ADR-0008（管理端基础，§7 留待决定的"正式管理员认证方案"）

## 背景

此前审核人只是 `content_reviews.reviewer_id` 里的自由文本（如 `david.han`），发布/审核操作靠命令行完成，没有身份校验。管理端即将成为审核、解除 Issue、确认转换、记录版权和发布的唯一入口，这些操作必须归属可验证、可追溯的管理员身份。学生侧按 ADR-0006 没有用户表，二者不应共用身份空间。

## 决定

1. **独立的 `admin_users` 表**，与学生身份完全分离：学生端 Bearer 令牌不被管理接口接受，管理员令牌也不被学生接口接受。管理员不是"权限更高的学生"。
2. **字段**：`id`(UUID)、`username`（小写唯一）、`display_name`、`password_hash`、`role`、`is_active`、`failed_login_count`、`locked_until`、`password_changed_at`、`created_at`、`last_login_at`。
3. **角色（有序包含）**：`viewer`（只读队列与原文对照）⊂ `reviewer`（确认转换、处理/解除 Issue、记录人工审核）⊂ `publisher`（记录版权决定、发布/撤回）。**QA Agent 没有管理员账号，因此永远不具备任何管理权限**，与 `api-conventions.md` "校验 Agent 不应拥有直接发布权限"一致。
4. **口令存储**：`hashlib.scrypt`（标准库，不新增依赖；每用户随机盐；`n=2^15, r=8, p=1`；常量时间比较）。哈希串自带参数，可日后升级。口令不进日志、不进环境变量、不进命令行参数。
5. **会话**：独立的 `admin_sessions` 表。登录返回 256 位随机不透明令牌，**库内只存其 SHA-256**；绝对过期 12 小时；可撤回（登出/停用账号时全部撤回）。使用 `Authorization: Bearer`，校验时同时检查未过期、未撤回、账号启用。
6. **登录防护**：连续失败 5 次锁定 15 分钟（`failed_login_count/locked_until`）；用户不存在与口令错误返回同样的 401，不泄漏账号存在性。
7. **FastAPI 依赖** `get_current_admin(min_role)`：缺失/无效令牌 401；角色不足 403。**不存在任何 dev_test 旁路**；本地开发也必须先用命令创建管理员。
8. **创建与口令重置只通过命令行**（`python -m app.admin_cli`）：口令用 `getpass` 交互输入（或测试注入），没有自助注册、没有"忘记密码"邮件流程。
9. **审计身份**：管理接口写审核/发布记录时，`reviewer_id` 一律由服务端取 `admin:<admin_users.id>`，**绝不接受客户端传入**。历史自由文本审核人（如 `david.han`）保留不改。
10. **迁移**：Alembic `0005` 新增两表（与 0003/0004 一致，后置表只在迁移中定义，不进 `metadata`）。

## 理由

- 管理操作可追溯到具体的人，且审核人不能被客户端伪造。
- 学生与管理员隔离，避免一类令牌泄漏波及另一类。
- 标准库 scrypt + 不透明令牌，攻击面小、无新增第三方依赖；比 JWT 更易撤回。

## 取舍与风险

- Bearer 令牌若放在前端存储，存在 XSS 窃取风险；缓解：12 小时绝对过期、可撤回、管理端 `noindex` 且不加载第三方脚本。后续可改为 httpOnly Cookie + CSRF，另立 ADR。
- 不含 MFA、SSO、口令找回；仅适合当前少量内部审核人员。扩大范围前需补充。
- 口令强度只做最小长度（≥12）校验；无泄漏口令库比对。
- 本 ADR 只决定后端身份；不决定管理端页面范围（见 `admin-frontend-implementation.md`）。

## 影响

- 新增 `backend/app/admin_auth.py`、`backend/app/admin_cli.py`、`backend/app/api/admin_auth.py`、Alembic `0005`，测试覆盖真实 PG。
- 后续管理接口统一依赖 `get_current_admin`；`apply-human`、`resolve_issue`、`confirm-rights`、`promote` 对外暴露时由服务端注入 `admin:<id>`。
- `docs/decisions/README.md` 新增 P-019 与 ADR 导航；`api-conventions.md` 补充管理端认证语义。
