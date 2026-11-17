# devlog · 2026-11-17 · 试卷详情页胶囊条目与面包屑

## 范围
用户指示：试卷详情页的所有条目改为标准胶囊；二级页面加纯文字面包屑（无背景），形如「试卷 > 详情」。

## 改动
- **面包屑**：新增 `components/Breadcrumb.tsx`（`nav[aria-label=面包屑] > ol`，祖先项为链接，最后一项普通文字 + `aria-current="page"`，`›` 分隔符 `aria-hidden`）；样式在 `global.scss`（14px、无背景、链接次要色悬停变品牌色）。试卷详情页用它替换原先的「返回试卷列表」`<a>`（该链接还是整页刷新的普通 `<a>`，现在是 SPA `Link`）。
- **胶囊条目**：把 `.exam-chip` 的胶囊样式提为通用 `.capsule-card`（56px、胶囊、白底、1px 边框、浅阴影，块级充满宽度）；大题行（Layer toggle）与练习组行（Unit）都用它。大题行：箭头 + 名称，右侧「N 组 · M 题」，可点击展开，悬停边框/文字变品牌色；练习组行缩进 24px，右侧题数 + 嵌在胶囊内的「开始练习」主按钮（36px 胶囊）。删除旧的 `.layer-block` 边框/背景与 `.unit-row` 分隔线样式。
- **设计规范**：`design-system.md` 新增 §3.6 面包屑，§6.5 补充适用范围（详情页大题/练习组）；`page-structure.md` 的详情页示意图同步。

## 测试
- 新增 `Breadcrumb.test.tsx` 3 例（祖先链接 + 当前页、分隔符装饰性且只在条目之间、无目标的条目为纯文字）；`ExamOutline.test.tsx` 新增 2 例（面包屑「试卷 > 详情」且无「返回试卷列表」、大题与练习组为 `.capsule-card` 且开始练习在胶囊内）。
- typecheck 通过；vitest **23 文件 / 207 passed**；`pnpm build` 通过。
- 容器内浏览器：详情页显示 `试卷 › 详情`（纯文字），6 个大题为 56px 全宽胶囊；展开「問題1」后 5 个练习组胶囊缩进显示、「开始练习」嵌在右侧；点击面包屑「试卷」回到 `/study/exams`。

## 未做 / 风险
- 面包屑目前只用在试卷详情页；练习页与结果页是否加（如 `试卷 › 详情 › 练习`）未做——这两页拿不到试卷标题/路径，需要先决定数据来源。
- 窄屏下练习组胶囊内「名称 + 题数 + 开始练习」的拥挤情况未实测（名称允许换行）；深色模式未测；展开箭头沿用字符 ▸/▾，未改成 SVG。

## 续：练习页与结果页加面包屑（同日，用户指示「也加上」）
- **后端**：会话各 Unit 的载荷新增 `exam_id`（`_session_payload` 通过 Unit 自己的 release 关联 `exam_releases.exam_id`），所以即使会话固定在已被新版本取代的旧 release，也能知道所属试卷；create/get/current/finish 都带上。`test_practice_sessions` 断言创建、恢复、按 id 读取三条路径都有 `exam_id`。无 Alembic 迁移（只读联表）。
- **前端**：`SessionUnitSchema` 增加 `exam_id`；契约夹具与各测试 mock 同步；新增 `PracticeBreadcrumb` 与 `useSessionExamId`。练习页：`试卷 › 详情 › 练习`；结果页（含「提前结束」「尚未完成」状态）：`试卷 › 详情 › 结果`；会话读不到时省略「详情」。
- 测试：后端 162 passed + 2 skipped；前端新增 4 例（练习页面包屑与 详情 链接、结果页含详情、会话 404 时省略详情、提前结束页也有面包屑），vitest **24 文件 / 211 passed**；typecheck、build 通过。容器内浏览器：从试卷详情开始「問題1-1」，练习页面包屑为 `试卷 › 详情 › 练习`，链接分别为 `/study/exams` 与 `/study/exams/JLPTGO-N2-2025-12`。
- 未在浏览器里查看：结果页与提前结束页的面包屑（仅单元测试覆盖）；窄屏。

## 续：专项练习卡片改普通元素、首页卡片与标准胶囊去边框（同日，用户指示；本次**未运行任何测试**，用户说由其自行校验）
- `subject-grid` 里的四张卡片由 `<button aria-disabled>` 改为 `<div>`（普通容器，不可聚焦；光标改为默认，删除 `[aria-disabled]` 样式）；去掉边框。
- `.study-home .card { border: none }`：首页的卡片（继续练习、专项练习、历年试卷快捷入口）都无边框；其它页面的 `.card` 不受影响。
- 标准胶囊卡片（`.capsule-card` / `.exam-chip`，含试卷列表月份胶囊、详情页大题与练习组）去掉 1px 边框；原来靠「边框变品牌色」表达的悬停，改为文字变品牌色 + 上浮 1px + 阴影加强为 `--shadow-floating`（过渡属性相应由 `border-color` 改为 `box-shadow`）。
- 文档：`design-system.md` §6.1（首页卡片无边框）、§6.2（专项练习卡片是 `div`、开放后应做成链接）、§6.5（胶囊无边框、悬停新规则）。
- **未运行**：typecheck、vitest、build、浏览器检查均未做。可能受影响：依赖 `button` 角色查询专项卡片的测试（我只搜索了测试里对 `subject`/`aria-disabled` 的引用，未发现，但未实际运行确认）；无边框后白卡片在浅粉渐变背景上的对比度完全靠阴影（`--shadow-card` 很淡），观感需要你确认；已部署的容器也尚未重建。

## 续：去掉专项卡片 ::after 装饰、加深阴影、写入设计规范（同日，用户指示；**未运行测试**）
- `.subject-card::after`（右下角浅色圆形装饰）及四个科目的 `::after` 配色规则删除；同时去掉只为它服务的 `overflow: hidden`。左上角图标的小面积科目色底保留。
- 阴影 Token 加深：`--shadow-card` `0 4px 18px 0.035` → `0 6px 24px 0.09`；`--shadow-floating` `0 8px 30px 0.075` → `0 12px 36px 0.15`。floating 必须同步加深，否则（card 0.09 > 原 floating 0.075）悬停反馈会比静止更弱。影响面：所有用 `--shadow-card` 的卡片/胶囊/静止态导航，以及用 `--shadow-floating` 的悬停、吸顶头部胶囊、Select/Popover，都会比之前深。
- 设计规范：`design-system.md` §8.2 阴影规则（数值、层级约束、无边框卡片靠阴影区分）、§13.1 Token 数值、§6.2（不使用角落装饰）。
- 未做：typecheck / vitest / build 均未运行（用户自行校验）；仅重建了 web 容器并确认 `/study` 返回 200，未查看渲染效果。吸顶头部胶囊、Popover 的阴影是否过深，需要在浏览器里确认。
