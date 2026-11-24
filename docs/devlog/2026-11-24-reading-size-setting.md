# 2026-11-24 题目字号设置

- 范围：新增只作用于题目阅读内容的字号设置（ADR-0034）。用户确认仅缩放做题内容，导航/头像等界面不变；存储未指定，按默认选 localStorage。
- 改动：`features/reading/`（`useReadingScale` 偏好 hook、`ReadingSizeControl` 全量/紧凑两种形态）；`root.tsx` 将 `--reading-scale` 写到 `<html>`；`global.scss` 中 `.richtext` 按该变量缩放；用户中心新增「阅读设置」，练习页头与模考顶栏加「Aa」循环按钮；`tokens.scss` 增加默认值；design-system §7.3 与 ADR 索引更新。无后端/Schema 变更。
- 测试：新增 `readingScale.test.tsx`（6 项：默认值、持久化并写变量、非法值忽略、多实例同步、单选组、紧凑循环）。`vitest run` 44 文件 375 passed；`tsc --noEmit` 无错误；`npm run build` 通过；`git diff --check` 无问题。
- 未执行：真实浏览器视觉验收、375px 窄屏溢出、Ruby 注音放大后重叠、模考顶栏在窄屏的拥挤情况、跨设备同步。
- 风险：`--reading-scale` 在 hydration 后才写入，首屏可能短暂以标准字号渲染再跳变；`.richtext` 若将来嵌套会重复缩放；模考顶栏新增按钮后窄屏可能换行。
