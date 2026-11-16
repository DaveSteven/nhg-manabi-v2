# 2026-11-16 · 管理员独立身份表（ADR-0009）

## 范围
按用户要求"管理员需要单独的管理员表"，落地管理端的后端身份基础：独立表、登录/会话、角色门禁、命令行管理。**不含**任何管理业务接口（审核队列、确认转换、发布等）和 `apps/admin` 前端，它们是后续切片。

## 决策（ADR-0009）
独立 `admin_users` / `admin_sessions`；角色 viewer ⊂ reviewer ⊂ publisher；QA Agent 无账号；标准库 scrypt 口令；256 位不透明令牌且库内只存 SHA-256，12 小时过期可撤回；连续失败 5 次锁 15 分钟；登录失败响应一致；无 dev 旁路；创建/重置只经命令行（getpass）；审计 `reviewer_id=admin:<id>` 由服务端写入。已写 ADR、更新 decisions README 与 `api-conventions.md`。

## 实现
- Alembic `0005_admin_identity`（两表、CHECK 角色/用户名/令牌哈希长度、索引）。
- `app/admin_auth.py`（口令哈希、账号、登录、令牌校验、`require_admin(min_role)`）、`app/api/admin_auth.py`（login/me/logout）、`app/admin_cli.py`（create-admin/reset-password/deactivate/activate）。

## 测试（先写后实现，真实 PG 隔离测试库）
- 新增 13 个：口令盐值与校验、创建校验与规范化、DB 约束、令牌只存哈希、失败登录不可区分、锁定与到期恢复、停用账号、登出、过期令牌、停用/重置口令撤销会话、角色矩阵 9 种组合 + 401、学生与管理员身份互不通用（无旁路）、CLI 不回显口令。
- **测试抓到一个真实 bug**：失败计数写在会抛异常的事务里会被回滚，锁定永不生效；已改为先提交计数再抛错。
- 后端全量：121 passed, 2 skipped（skip 为缺本地 Canonical Archive.zip，环境性）。
- 迁移：测试库 downgrade→upgrade 验证；开发库已升级到 `0005_admin_identity (head)`。一次降级后的表计数检查读到 1（预期 0），干净重跑为 0 后再升级恢复，首次读数原因未查明，现象不可复现。

## 未完成 / 风险
- **尚未创建任何管理员账号**：口令必须你本人在终端交互输入，我没有也不会代输。命令：`python -m app.admin_cli create-admin <用户名> --role publisher`。
- 无 MFA/SSO/找回；口令仅长度 ≥12；令牌放前端存储有 XSS 风险（ADR 已记，后续可改 httpOnly Cookie）。
- 现有命令行（`resolve_issue`、`apply-human`、`confirm-rights`、`promote`）仍接受自由文本审核人，尚未接入管理员身份；后续切片把它们包成受保护接口。
- 未做登录速率限制之外的 IP 级限流；未前端联调。
