# 2026-11-18 管理端用户管理（P0–P2）

## 范围
按用户给定的「管理端用户管理页面设计方案」实现：用户列表（P0）、用户详情（P1）、账号启用/禁用与操作审计（P2）。口径见 [admin-users.md](../development/admin-users.md)。

## 改动
- 迁移 `0018_admin_audit_logs`（仅追加审计表）；开发库已 up/down/up。
- 后端 `app/api/admin_users.py`（列表/详情/启用/禁用）；`learning.py` 抽出 `history_items` 供详情复用（学生端行为不变）。
- 管理端 `features/users`（列表页、详情页）、`lib/api.ts` 严格 zod 契约、侧栏「用户管理」、路由 `/users`、`/users/$userId`。
- 测试：后端 `test_admin_users.py` 7 项（权限、活跃状态与 6/7、30/31 天边界、筛选/搜索/LIKE 转义/排序/分页、与 Dashboard 口径一致、最近访问仅取访问日期、详情、禁用/启用/审计/会话撤销/历史保留）；管理端 `users.unit.test.tsx` 7 项。

## 决策 / 取舍
- 活跃阈值：活跃 ≤6 天、近期未活跃 7–30 天、长期沉默 ≥31 天（方案原文 8–30 天的边界按此落地）。
- 列表含全部账号，顶部指标沿用 Dashboard 有效用户口径。
- 未做只读结果详情跳转（隐私边界待评审）；头像用首字母。无架构变化，未新增 ADR。

## 测试结果（真实输出）
- 后端（本地 PG）：`pytest` 287 passed, 2 skipped。
- 管理端：`vitest run --config vitest.unit.config.ts` 43 passed；`tsc -b` 无错误；eslint（新增文件）无输出；`pnpm build` 通过。
- `git diff --check` 通过。

## 未执行 / 风险
- 未做真实浏览器视觉验收、未重建 Docker 容器、开发库未用真实数据走查；生产未部署。
- 新增接口需重启后端；全量用户子查询未做大数据量性能评估。
