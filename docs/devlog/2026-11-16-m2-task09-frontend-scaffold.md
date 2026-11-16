# Devlog · M2.2 Task 09 · 前端基础工程（React Router SSG+SPA 脚手架）

**日期：** 2026-11-16
**范围：** M2.2 Commit 1（`feat(web): scaffold react router ssg spa app`）。按 ADR-0007 与《M2.2-frontend-implementation.md》建立 pnpm workspace 与 `apps/web` 工程：路由树、樱与墨 tokens、API adapter 层、构建验收。页面内容为占位壳（Commit 2–4 填充）。

## 改动内容

1. **Workspace**：根 `package.json`（`packageManager: pnpm@12.21.0`、`engines.node >=20`、dev/build/test 脚本）+ `pnpm-workspace.yaml`（`apps/*`；`allowBuilds: esbuild/msw` 为 pnpm 12 写回的格式）。
2. **工程**（`apps/web`）：
   - `react-router.config.ts`：`ssr:false` + `prerender:["/"]`。
   - `app/routes.ts`（RR 7.18 强制路由配置文件）：`/` 品牌页 + `/study` 布局 + `study._index` / `study.exams._index` / `study.exams.$examId` / `study.practice.$sessionId` / `study.practice.$sessionId.results`。
   - `app/root.tsx`（默认 meta 含 `noindex`；品牌页覆写为 `index,follow` + canonical/description/og → SPA fallback 天然 noindex）；`app/entry.server.tsx`（**仅构建期 prerender 用**，无运行时 Node SSR 服务，`ssr:false` 下产物只含 client）。
   - `app/styles/tokens.css`：樱与墨 11 个色 token 原值 + 4px 间距 + 8/12/16/20 圆角 + 字体栈（UI sans + Noto Sans JP fallback；长文阅读衬线用系统衬线栈）+ `--audio-dock-height` 预留；`global.css`：reset、focus-visible、reduced-motion、1180px 容器、下划线 Tab / 顶导航样式、44px 触控高度。
   - `app/components/TopNav.tsx`（首页→`/study`、历年试卷→`/study/exams`；专项练习/我的学习为 `aria-disabled` 的「暂未开放」入口）、`NotAvailable.tsx`。
3. **API 层**（`app/api/`）：
   - `errors.ts`：`ApiError` 归一化三种后端 detail 形状（域错误 dict 保留 extras 如 `active_session_id`/`current_row_version`；字符串 detail 按状态映射 code；FastAPI list 形状拼接 loc+msg）。
   - `client.ts`：fetch 封装（JSON、Bearer、恒抛 ApiError、network_error、204→null）。
   - `authToken.ts`：`VITE_DEV_USER_TOKEN` + localStorage 覆写（dev_test 专用，ADR-0006）。
   - `dto/`：`exam` / `unit` / `practice` 三组 zod `strictObject` schema，逐字段对照已核实的后端载荷；`PublicUnit` strictObject **故意拒绝 `cues` / `correct_option_id` 字段**——未来公开 API 若泄漏字幕或答案，DTO 解析会立刻报错。`parseDto` 抛可诊断 `DtoParseError`。
   - `endpoints/`：`exams.ts`（含 `getReleaseUnit` 固定 Release 读取与 `releaseAssetUrl(release_id, asset_id)` 媒体定位）、`sessions.ts`（create/current/get/drafts/submit/feedback/finish/results）。
   - `queryClient.ts`：会话/作答类 `staleTime: 0`（服务端为事实源）。
4. **Vite dev proxy**：`/api` → `BACKEND_URL`（默认 `http://localhost:8001`），同源方案，**本次不加后端 CORS 中间件**（计划裁决）。
5. **构建验收**（`scripts/check-build.mjs`，`pnpm build` 自动执行）：`index.html` 为含 H1/description/canonical 且无 noindex 的真实预渲染 HTML；`__spa-fallback.html` 存在且 noindex；扫描构建产物断言 `.env` 凭据无泄漏。
6. **vitest 集成**：jsdom + RTL + jest-dom + MSW（依赖已装，Commit 2 起使用）；`process.env.VITEST` 下不加载 reactRouter 插件（插件 preamble 仅存在于 dev server/build 上下文）。

## 实际执行的测试与结果

- `pnpm -F web typecheck`（tsc --noEmit, strict）：**通过**。
- `pnpm -F web test`：**37 passed（6 文件）**。覆盖：错误归一化（域错误 extras / 字符串 / list 422 / 状态映射）、client（JSON/Bearer/409 dict/422 list/网络错误/204）、DTO×3（真实形状接受；未知字段、缺失字段带路径、错误类型、**cues 与 correct_option_id 泄漏字段被拒绝**、units_meta 仅创建响应、finish 双结果、三态逐题结果）、TopNav（四项、aria-disabled 暂未开放）、路由树 smoke（5 条 /study 路由 + 品牌页不在学习布局下）。
- `pnpm -F web build`：**通过**——`Prerender (html): / -> build/client/index.html`、`SPA Fallback -> build/client/__spa-fallback.html`，`ssr:false` 移除 server 产物，`check-build.mjs` 全部断言通过（预渲染品牌 HTML、noindex fallback、凭据无泄漏）。

## 决策记录（实现期）

- RR 7.18 强制 `app/routes.ts` 路由配置（文件约定不再默认启用）——采用 `route()/index()` 配置式；路由文件名保留 `$param` 命名。
- 需要 `entry.server.tsx`（prerender 构建期执行）；同时需要 `@react-router/node`+`isbot` 依赖检测，但 `@react-router/node` 解析到 8.x 也满足检测；未使用其运行时。**部署产物不含 server 构建**。
- vitest 与 reactRouter 插件不兼容（preamble 检测）→ 测试环境禁用该插件；路由模块作为普通组件渲染。

## 未执行 / 留待后续

- MSW Mock API 集成测试：Commit 2 起（依赖已安装）。
- 品牌页真实文案/设计：本提交为最小占位（H1 + 简介进入学习链接），真实品牌内容待设计输入。
- Playwright E2E、视觉走查、多设备验收：M2.3。
- 真实 API 联调（学习首页/目录）：Commit 2 手动走查时执行。

## 文档冲突记录（不在本里程碑修改，仅登记）

- `docs/design/page-structure.md` 仍使用 `/home`、`/practice`、`/exams` 路径；M2.2 §3 已裁决为 `/study` 命名空间，以 M2.2 计划为准。
- `docs/development/api-conventions.md` 提议 `/api/v1` 前缀与 Idempotency-Key 头；实际后端为裸 `/api` 且无 Idempotency-Key（M2.2 §1.2 已注明），前端按实际契约实现。
