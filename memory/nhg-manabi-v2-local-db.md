---
name: nhg-manabi-v2-local-db
description: nhg-manabi-v2 本地 PostgreSQL 环境与测试运行方式
metadata:
  type: project
---

nhg-manabi-v2 本地数据库于 2026-11-15 落地：Docker 容器 `nhg-manabi-v2-db`（postgres:16-alpine），端口 `127.0.0.1:55432`，凭据在仓库根 `.env`（不入库）。运行迁移/测试需 `set -a && source ../.env && set +a` 后在 `backend/` 下执行；`tests/test_constraints_pg.py` 无 `DATABASE_URL` 时自动跳过。约束测试种子使用固定 `exam_id='exam-test'`，清理按该 id 子查询级联删除。注意旧项目 `nhg-manabi` 的容器（nhg-manabi-db/nhg-manabi-api，端口 5432/8000）仍在运行，属旧项目，勿动。

**Why:** 跨会话的本地机器状态（容器、.env 密码）无法从仓库推导。
**How to apply:** 涉及数据库迁移或真实 PG 测试时先确认容器在跑并 source .env；不要把 .env 内容写入代码或日志。
