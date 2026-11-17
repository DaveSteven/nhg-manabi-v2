# 2026-11-17 · 首页移除「历年试卷」模块

## 范围
首页不再展示「历年试卷」入口模块（最近 3 套试卷卡片 + 查看全部）。历年试卷仍通过顶部导航「历年试卷」进入。纯前端调整，无 API/Schema/ADR 变化。

## 改动
- `StudyHome.tsx`：删除该 section 及 CalendarIcon、等级筛选（useLevel）与相关 import；继续练习卡片仍使用试卷目录取标题。
- `_catalog.scss`：删除 `.section-more`、`.exam-quick*` 样式。
- `StudyHome.test.tsx`：删除该模块相关 5 项用例（快速入口、等级筛选 ×3、空目录/目录错误提示）。

## 测试（实际执行）
- `tsc --noEmit` 通过；`vitest run` 24 文件 / 225 passed；`npm run build` 通过。
- web 容器重建并重启，`localhost:8080` 返回 200。
- 未执行：真实浏览器目检、Firefox/Safari、深色模式。

## 备注
专项练习卡片文案「可先用历年试卷」保留，指向顶栏入口，如需调整另行确认。
