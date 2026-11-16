# 2026-11-16 · 管理端登录（apps/admin）

## 范围
把用户放入 `apps/admin` 的 shadcn-admin 上游代码接上真实登录：去掉 Clerk 与演示内容，对接 FastAPI 管理员认证（ADR-0009/0010）。只做登录/退出/受保护壳层/首页，**没有任何审核或发布页面**（ADR-0010 暂不做审核流程）。

## 过程与取舍
1. **先提交未改动的上游基线**（`f1d58ca`，v2.2.1，MIT，不含密钥）：删除演示代码前必须可恢复；一次批量 `rm -rf` 被安全分类器拦下（`apps/admin` 当时未入库，删除不可恢复），改为先提交基线再 `git rm`。
2. 审查上游：`_authenticated` 路由**没有任何鉴权**（登录是 2 秒假延迟 + 假令牌）；`index.html` 引用 Google Fonts 与 netlify 的 OG 元数据；有 Clerk 依赖。均已处理。
3. 删除：Clerk 路由/依赖/Logo，全部演示功能页（apps/chats/tasks/users/settings/dashboard/help-center/errors 演示）与注册/忘记密码/OTP/sign-in-2 页面。
4. 新增：`lib/api.ts`（axios，Bearer 来自 store，响应用 zod strict 校验）、`stores/auth-store.ts`（令牌存 **sessionStorage**，不用 Cookie/localStorage/URL）、真实登录表单（中文，区分"凭据错误/账号锁定"与"服务不可达"，`safeRedirect` 防开放重定向）、**服务端校验的路由守卫**（`beforeLoad` 调 `/me`；401 清会话并跳转，后端不可达时报错而不是伪造会话）、退出登录（先调 `/logout` 撤销服务端会话）、首页、`THIRD_PARTY.md`（来源/版本/许可/本地改动）、README。
5. Vite 开发代理 `/api` → `BACKEND_URL`（默认 8001），端口 5175；`index.html` 去掉外部字体与 OG，加 `noindex`。
6. 工作区依赖冲突：admin 带来 vitest 4，web 是 vitest 3，导致 web 的 `@testing-library/jest-dom/vitest` 绑定到错误的 vitest，**50 个 web 测试失去匹配器**。改为在 web 的 setup 里用本包的 `expect.extend(matchers)` 并本地补类型声明（`2e2ba62`）；admin 单测不使用 jest-dom。
7. `@parcel/watcher` 的构建脚本未批准（`pnpm install` 因 ignored build scripts 返回非零但依赖已安装）。

## 超级管理员
`admin` 已创建，口令在被 gitignore 的 `.local/admin-initial-credentials.txt`（权限 600）。已用 curl 对真实后端验证：正确口令 200（role=super_admin）、无令牌 401、错误口令 401。浏览器验证使用临时账号 `e2e-check`（已从开发库删除）。**注意：验证时错误口令请求使 `admin` 的失败计数为 1，下次成功登录即清零。**

## 测试
- admin：`tsc -b` 通过；`eslint src` 通过；`pnpm test:unit` 20 passed（safeRedirect、auth-store、api 客户端含 msw、登录表单 5 例）；`vite build` 通过。
- web：`tsc --noEmit` 通过；123 passed；build 通过。
- 后端：127 passed, 2 skipped（缺本地 Canonical Archive.zip，环境性）。
- **真实浏览器**（内置浏览器 + 真实 FastAPI）：未登录访问 `/` 被重定向到 `/sign-in?redirect=%2F`；错误口令显示红色错误且不跳转；正确口令进入首页并显示姓名与 super_admin；令牌只在 sessionStorage（无 Cookie、无 localStorage、不在 URL）；强制刷新后会话保持；退出后跳回登录、本地令牌清空，**旧令牌对服务端返回 401**。

## 未执行 / 未覆盖
- 上游自带的浏览器模式测试（`pnpm -F admin test`）需要下载 Playwright Chromium，未执行，也未验证剩余的上游测试（cookies、password-input、confirm-dialog、config-drawer）是否仍通过。
- 令牌放在 sessionStorage 有 XSS 风险（已在 ADR-0009 记录）；未做 CSRF/Cookie 方案。
- 只在内置浏览器、桌面宽度验证；未测手机宽度与其他浏览器。
- 侧边栏仍保留上游的主题/布局设置抽屉与命令菜单，未逐项核对中文化；若干上游文案仍是英文。
- 管理端尚无业务页面；`PUBLISH_POLICY=auto` 下也没有管理端入口查看发布结果。
