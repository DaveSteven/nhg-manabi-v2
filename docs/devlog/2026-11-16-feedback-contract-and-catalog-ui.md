# 2026-11-16 · feedback 契约统一 + 目录页样式 + 多视口走查

## 范围
承接 M2.3 首轮验收：(1) 后端统一 feedback 载荷；(2) 修复用户反馈的首页"原始样式"问题；(3) 顶栏高亮与加载错误文案；(4) 多视口走查。

## 改动
- **后端**：`POST submit` 内嵌的 `feedback` 现在与 `GET /feedback` 同形（均含 `feedback_mode`）。`test_study_flow` 增加断言：内嵌键集合 == GET 键集合。前端 `FeedbackPayloadSchema.feedback_mode` 恢复为必填；夹具重新采集（18 份），契约测试通过。
- **根因（用户截图的首页）**：学习首页、试卷列表、试卷大纲用到的约 25 个 class（`subject-grid/card`、`continue-card`、`exam-*`、`layer-*`、`unit-*`、`primary-link`、`feedback-mode` 等）**从未写过 CSS**，只有练习页有样式。新增 `styles/_catalog.scss`（仅用设计 token）：四学科入口 1/2/4 列（<720 / ≥720 / ≥1100）、继续练习卡片、试卷行、Layer 折叠、Unit 行、主按钮、学科 Tab 可横滚。
- **顶栏**：`首页` NavLink 加 `end`，不再在 `/study/*` 子路由全程高亮；测试覆盖。
- **加载错误文案**：新增 `describeLoadError`：未登录 / 无法连接学习服务（网络错误或 5xx，即后端没起来）/ 通用失败，不再只说"请稍后重试"。首页与试卷列表使用。

## 实际执行
- 后端 `pytest`（真实 PG）：103 passed, 2 skipped（skip 为缺本地 Canonical Archive.zip，环境性）。
- 前端 `tsc --noEmit` 通过；`vitest`：121 passed（含新增 TopNav 与 describeLoadError 测试）；`pnpm build`（含 check-build）通过。
- API 验收 `e2e_api_check.py`：36/36。
- 真实浏览器（内置浏览器 + 真实 uvicorn + 隔离库）：首页 800px（2×2）、试卷大纲 1440px、练习页 390px（cloze 5 slot）与 360px（听力）；程序化测量 360px 下 home/exams/outline/practice 四页 `scrollWidth == clientWidth`（无横向溢出）；360px 听力页滚到底后提交按钮底边 572 < 播放 dock 顶 676，不被遮挡。

## 未执行 / 未覆盖
- 仅 Chromium 系内置浏览器；Chrome 桌面、Firefox、Safari 未测；1024 / 768 档只通过 800px 与断点逻辑间接覆盖，未逐档截图。
- ≥1100px 的四列入口布局只在 1440 看了大纲页，未专门截图首页四列。
- 文本 200% 缩放、键盘 Tab 顺序、深色模式未检查。
- 品牌首页 `/` 仍是占位文案；"专项练习""我的学习"仍为暂未开放。
- 视觉仅做到"结构清晰、token 一致"，未做设计稿比对（无设计稿输入）。
- 上述视觉走查为人工观察，无自动化视觉回归。
