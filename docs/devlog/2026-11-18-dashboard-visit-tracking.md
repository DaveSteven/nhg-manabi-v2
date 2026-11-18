# 2026-11-18 Dashboard 访问埋点（P1 首项）

## 范围
为 Dashboard 提供可靠的访问活跃与漏斗访问阶段，数据最小化。

## 改动
- Alembic 0017 `user_visit_days(user_id, visit_date, first_seen_at)`，主键 (user, 东京日) 保证幂等，日期索引；不入 `schema.py`（与 0007 之后迁移表一致，metadata 仍 32 表）。
- `POST /api/me/visit`（204，需学生登录，服务端按东京日写入，`ON CONFLICT DO NOTHING`）。
- Dashboard：`visit` 日序列、`visit_tracking.since/note`、漏斗 `visit_users`、`visit_to_start_rate`；采集起点前日期为 null；排除邮箱同样过滤访问。
- 学生端 `features/auth/visitBeacon.ts`，挂在 `/study` 布局；每浏览器每用户每东京日最多一次，失败静默。管理端折线图增加访问线与漏斗访问行。

## 决策与取舍
- 仅登录用户计访问（匿名无法去重且不想引入指纹/Cookie 追踪）；不存 IP、UA、路径。未新增 ADR（不改架构，口径写入 `docs/development/admin-dashboard.md`）。
- 访问→开始转化率因旧页面缓存可能 >100% 的边角情形未做截断，仅作参考。

## 测试（实际执行）
- 后端全量（本地 PG）280 passed, 2 skipped；迁移 0017 downgrade/upgrade 通过。新增访问幂等/401/仪表盘接入/排除测试。
- web：vitest 347 passed（含 visitBeacon 3 项），`tsc --noEmit` 通过；admin：36 单测、tsc -b、eslint、build 通过。
- 未执行：真实浏览器端到端、容器重建、Firefox/Safari。

## 风险
开发库已升级到 0017，其他环境需跑迁移；访问数据从上线日起累积，短期内访问线较短。
