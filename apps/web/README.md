# apps/web · JLPT GO 2.0 学生端

React Router Framework Mode（ADR-0007）：品牌首页 `/` 静态预渲染（SSG），`/study` 及学习路由为 SPA；不引入运行时 Node SSR。FastAPI 仍是业务与权限事实源。

## 常用命令

```bash
pnpm install                 # 仓库根（workspace）
pnpm dev                     # Vite dev server（/api 代理到 localhost:8001）
pnpm -F web typecheck        # tsc --noEmit（同时充当 lint）
pnpm -F web test             # vitest run（jsdom + RTL + MSW）
pnpm -F web build            # 生产构建 + check-build.mjs 产物验收
```

## 环境变量

见 `.env.example`。要点：

- `VITE_API_BASE` 默认空 = 同源 `/api`（dev 由 Vite proxy 转发到 `BACKEND_URL`（默认 `http://localhost:8001`）；生产由静态宿主同源代理）。
- `VITE_DEV_USER_TOKEN`：仅开发（ADR-0006 `dev_test` 身份，生产硬禁用）。
- `VITE_SITE_URL`：构建期写入 canonical/meta。

## 后端配合

```bash
docker compose --env-file .env up -d postgres
cd backend && alembic upgrade head && uvicorn app.main:app --reload --port 8001
```

开发身份：backend 环境设 `AUTH_MODE=dev_test`、`DEV_TEST_USER_IDS=<uuid>[,...]`，前端 `VITE_DEV_USER_TOKEN=<同一 uuid>`。

## 结构

- `app/routes/`：品牌页（SSG）与 `/study` SPA 路由（`study.tsx` 为学习布局，下划线活动态顶导航）。
- `app/features/`：按领域组织（catalog 试卷目录 / practice 作答 / content Canonical 渲染）。
- `app/api/`：HTTP adapter、DTO 运行时校验（zod strictObject，未知/缺失字段报错）、错误归一化（三种后端 detail 形状）。snake_case 只存在于该边界内。
- `app/styles/`：樱与墨 tokens（`design-system.md` 数值为准）。
- `scripts/check-build.mjs`：构建产物验收（预渲染 HTML、noindex fallback、凭据泄漏）。

## 测试分层（M2.2 §10.1）

单元（DTO/RichText/状态机）→ 组件交互（RTL）→ Mock API 集成（MSW）→ 构建检查。Playwright E2E 属 M2.3。
