# 2026-11-17 · 成组题一页展示全部小题

## 范围
按用户要求，文法成组/阅读多问不再逐小题切换（ADR-0017）。纯前端。

## 改动
- `UnifiedPractice.tsx`：步进单位改为 Unit；一页渲染材料 + 全部小题；按钮 上一/下一 组/篇/题（复用 `quickPracticeCopy`）；顶部导航条改为题组条（一组一格，不展示小题号）；进度「第 x/M 组 · 第 a–b/N 题」。复盘时每题下显示解析。
- `PracticePage.tsx`：移除 Quick 多题 Unit 的小题分页；删 `.question-pager` 样式。
- 测试：`UnifiedPractice.test.tsx`、`PracticePage.test.tsx` 相应改写（同页可见全部小题、无小题级翻页）。
- 文档：practice-interactions、frontend-spec、quick-practice 同步；新增 ADR-0017。

## 测试
- `npx tsc --noEmit`：通过。
- `npx vitest run`（apps/web）：29 files / 250 tests 通过（happy-dom 卸载 fetch 的 stderr 噪声为既有问题）。
- 未执行：浏览器视觉/375px 走查、后端测试（未改后端）、`pnpm build`。

## 剩余风险
长阅读多问页面较长，双栏固定材料未做；滚动定位仅在真实浏览器未验证。
