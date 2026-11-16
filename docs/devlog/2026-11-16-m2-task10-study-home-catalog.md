# Devlog · M2.2 Task 10 · 学习首页与试卷目录

**日期：** 2026-11-16
**范围：** M2.2 Commit 2（`feat(web): implement study home and exam catalog`）：学习首页（四学科入口 + 继续上次练习 + 试卷入口）、试卷列表（等级/年份 URL 筛选）、试卷详情（Section 下划线 Tab / Layer 展开 / Unit 列表）、单 Unit 练习入口与 409 活跃会话冲突 UI、MSW Mock API 集成测试。

## 改动内容

1. **`features/catalog/`**：
   - `useExamCatalog.ts`：`useExamList` / `useExamOutline`（staleTime 5min，按 release 缓存）；`useCurrentSession` 返回 discriminated 状态 `loading / error / unauthenticated / no-active / active`——`GET sessions/current` 的 404 "no active practice" 映射为安静的「无活跃练习」，绝不渲染错误横幅。
   - `StudyHome.tsx`：四学科入口卡片为第一视觉焦点（专项练习未开放→卡片标注「暂未开放 · 可先用历年试卷」，不伪造导航）；有活跃 Session 时显示继续卡片（进入 `/study/practice/:id`）；试卷目录与当前会话并行请求、各自独立 loading/错误/空态。
   - `ExamList.tsx`：真实 level/year/month/title（不硬编码月份）；筛选写入 URL search params（刷新可恢复）；区分「暂无已发布试卷」与「无符合筛选条件」两种空态；401 与网络错误是不同提示。
   - `ExamOutline.tsx`：页面级下划线 Tab（role=tablist，服务端 position 顺序）；Layer 展开（本地可丢失 UI state）；Unit 行显示服务端 label/question_count；单 Unit 入口 POST createSession（release_id 取试卷轮廓当前 release）；反馈方式选择（immediate 默认，存 UI 状态）。
   - `viewModels.ts`：subject→中文显示名映射；不按数组索引重建编号。
2. **`features/practice/`**：
   - `useStartPractice.ts`：createSession mutation；409 `active_session_exists` 识别为 conflict（含 `active_session_id`）；`useFinishSession` 供结束旧练习用。
   - `ActiveSessionConflictDialog.tsx`：P-010 冲突 UI——「继续旧练习」（跳转旧 Session）或「结束旧练习后开始」；后者先弹出确认，明确说明未提交题目不计分、不生成完整成绩，确认后才 finish + 重建。
3. **测试**：MSW server（`app/test/mocks/server.ts`，通配路径 `*/api/...` 以摆脱 DOM origin 差异）；StudyHome 6 例、ExamList 3 例、ExamOutline 5 例（Tab 切换、展开+发起练习捕获请求体、409 冲突对话框双分支、结束旧练习需显式确认且确认前零 finish 请求、非冲突错误无对话框）。

## 实现期发现与修复（重要，供后续参考）

1. **jsdom realm 冲突导致所有客户端导航静默失败**：react-router 7 数据路由每次导航都会 `new Request(url, { signal })`——Node undici 的 Request 拒绝 jsdom realm 的 AbortSignal（`RequestInit: Expected signal ... to be an instance of AbortSignal`），导航请求直接抛错且 UI 无提示。**解决：vitest 环境改用 happy-dom**（单一 realm 的 fetch/Request/AbortController）。此问题影响后续所有作答页测试环境，已记入 README 测试说明需保持一致。
2. `apiFetch` 同源默认改为 `window.location.origin` 前缀（相对路径在 Node fetch 下非法）；AbortSignal 采用跨 realm 安全的「竞态中止」桥接（不再把外部 signal 直接传给 fetch）。
3. MSW `resetHandlers()` 会连同清掉 `beforeAll` 中注册的 handler——每个用例须自注册依赖的 mock。
4. React Query 默认对 5xx 重试一次（1s 退避）——错误路径断言测试显式传 `retry:false` 的 QueryClient。

## 实际执行的测试与结果

- `pnpm -F web typecheck`：**通过**。
- `pnpm -F web test`：**51 passed（9 文件）**（Commit 1 的 37 + 本提交新增 14；含 MSW 集成、路由集成）。
- `pnpm -F web build`：**通过**（预渲染/回退/凭据检查不变仍绿）。

## 未执行 / 留待后续

- **真实后端手动走查**（真实 PG + dev_test 身份 + 目录→发起练习）：本提交的 MSW 集成只钉住前端行为；真实联调与作答闭环走查合并到 Commit 4 完成后一次执行并记录（避免中间态重复搭环境）。
- 学习首页四学科入口的目标页面（专项随机练习）不在 M2.2 范围。
- Playwright E2E、视觉走查：M2.3。
