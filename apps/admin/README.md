# apps/admin · JLPT GO 管理端

独立 React SPA（Vite + Ant Design 6，ADR-0028；身份与发布见 ADR-0009/0010，工程来源见 `THIRD_PARTY.md`）。FastAPI 是身份与权限的唯一事实源，前端路由守卫只改善体验。

## 运行

```bash
# 1) 后端（默认端口 8001）
cd backend && set -a && source ../.env && set +a && .venv/bin/uvicorn app.main:app --port 8001
# 2) 管理端 → http://localhost:5175
pnpm -F admin dev
```

开发代理：`/api` → `BACKEND_URL`（默认 `http://localhost:8001`）。

## 账号

只有 `super_admin`（ADR-0010）。创建/改密只通过命令行，口令交互输入：

```bash
cd backend && .venv/bin/python -m app.admin_cli create-admin <用户名>
cd backend && .venv/bin/python -m app.admin_cli reset-password <用户名>
```

开发库已创建 `admin`，初始口令在被 gitignore 的 `.local/admin-initial-credentials.txt`。

## 检查

```bash
pnpm -F admin exec tsc -b && pnpm -F admin exec eslint src
pnpm -F admin test:unit       # happy-dom 单元测试
pnpm -F admin build
```

## 现状

登录/退出、运营 Dashboard、试卷管理（下架/恢复）、用户管理（列表/详情/禁用启用）。审核流程暂不做（ADR-0010）。
