# ADR-0018 长篇读解 / 文章填空：桌面双栏 Sticky 答题面板

状态：已接受（用户 2026-11-17 提供规范）。仅桌面（≥1024px）；窄屏仍上下堆叠。不改后端与数据模型。

## 决定
1. 适用：Unit 类型为 `passage`，或带 slot 的文章填空，且有正文材料。其他 Unit 保持单列。
2. 布局：`grid-template-columns: minmax(0,1.4fr) minmax(340px,1fr)`，间距 24px。左侧文章随页面自然滚动；右侧 `.reading-question-panel` `position: sticky`，`top: 104px`（避开站点顶栏），`max-height: calc(100dvh - 104px - 24px)`，内部可独立滚动，Sticky 仅限该 Unit 外层容器，不进入下一篇。
3. 与 ADR-0017 的衔接：右侧面板内仍列出本 Unit 全部小题（不逐题切换），顶部为本篇题号 chip；提交/翻页按钮放在面板底部，始终可达。
4. 联动（仅展示层）：点击文章中的 slot → 面板定位并高亮对应题；点击面板题号 → 文章定位到对应 slot（带 scroll-margin 避开顶栏）。激活状态通过 DOM class 切换，不重渲染文章，不影响草稿与提交。
5. 切题/滚动不重置文章位置；草稿保存与提交流程不变。
