# 2026-11-18 管理端 Dashboard P0

## 范围
按用户给出的 Dashboard 设计方案实现 P0：四项指标、7/30 天切换、每日学习活跃趋势、学习功能使用、转化漏斗（访问阶段不可用）、两条运营提醒。口径见 `docs/development/admin-dashboard.md`。

## 改动
- 后端：`app/api/admin_dashboard.py`（只读聚合，复用现有表，无迁移）并挂入 `main.py`。
- 管理端：`features/dashboard`（替换占位首页，删除 `features/home`）、`lib/api.ts` 增加 zod strict DTO。
- 测试：`backend/tests/test_admin_dashboard.py`（5）、`dashboard.unit.test.tsx`（4）。

## 决策与取舍
- 无访问事件采集 → 访问活跃/访问漏斗返回 null 并明示，未用登录次数冒充。
- 错题复习通过 `config.topic.selection` 区分，避免与专项重复计数。
- 测试账号排除用环境变量 `DASHBOARD_EXCLUDE_EMAILS`，未改 Schema。未新增 ADR（不改架构）。

## 测试（实际执行）
- 后端全量（真实本地 PG）：279 passed, 2 skipped。
- admin 单测 `pnpm test:unit`：35 passed；`tsc -b`、`pnpm build`、eslint（dashboard 目录）通过。
- 未执行：真实浏览器视觉走查、容器重建、大数据量性能评估。

## 剩余风险
访问埋点、资源异常提醒、用户管理联动（P1）未做；聚合查询对大数据量未做索引评估；`submitted_at` 无单独索引。
