# 2026-11-17 · 长篇读解 / 文章填空：桌面双栏 Sticky 答题面板

## 范围
按用户提供的规范实现（ADR-0018）。纯前端，仅桌面（≥1024px）。

## 改动
- 新增 `features/content/SharedMaterialLayout.tsx`：passage Unit 或带 slot 的有正文 Unit 使用双栏；左文章、右 sticky 面板（内含本篇全部小题、题号 chip、底部提交/翻页按钮）；slot↔题联动用 DOM class 切换，不重渲染文章。
- `UnifiedPractice.tsx`、`PracticePage.tsx` 接入；`_practice.scss` 增加布局/sticky/内部滚动样式。
- 与 ADR-0017 的取舍：规范原文为「右侧切换当前题」，这里保持「面板内列出全部小题」以满足先前「小题全部展示」的要求，面板可内部滚动。
- 文档：ADR-0018、frontend-spec、progress。

## 修订（同日，用户指示）
右侧面板改为一次只显示一道小题（题号 chip + 上一小题/下一小题；非当前题 CSS 隐藏但保持挂载）。其余成组题（无双栏）仍一页全部列出。真实浏览器仍未验收。

## 测试
- `npx tsc --noEmit` 通过；`npx vitest run`：253 passed（新增 SharedMaterialLayout 3 例：分栏判定、非分栏、slot 点击/题号联动与底部按钮在面板内）。
- `pnpm build` 通过；docker web 镜像已重建，8080 返回 200。
- **未执行**：真实浏览器验收（需登录账户，未代为输入凭据）——sticky 实际吸附位置、与顶栏间距（104px 为估值）、面板内滚动与页面滚动冲突、slot 定位被顶栏遮挡与否均未验证。

## 风险
顶栏实际高度需按真实页面校准 `--sticky-offset`；听力 Dock 与面板底部的避让未专门处理。
