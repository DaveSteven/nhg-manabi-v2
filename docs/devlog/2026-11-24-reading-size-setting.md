# 2026-11-24 题目字号设置

- 范围：新增只作用于题目阅读内容的字号设置（ADR-0034）。用户确认仅缩放做题内容，导航/头像等界面不变；存储未指定，按默认选 localStorage。
- 改动：`features/reading/`（`useReadingScale` 偏好 hook、`ReadingSizeControl` 全量/紧凑两种形态）；`root.tsx` 将 `--reading-scale` 写到 `<html>`；`global.scss` 中 `.richtext` 按该变量缩放；用户中心新增「阅读设置」，练习页头与模考顶栏加「Aa」循环按钮；`tokens.scss` 增加默认值；design-system §7.3 与 ADR 索引更新。无后端/Schema 变更。
- 测试：新增 `readingScale.test.tsx`（6 项：默认值、持久化并写变量、非法值忽略、多实例同步、单选组、紧凑循环）。`vitest run` 44 文件 375 passed；`tsc --noEmit` 无错误；`npm run build` 通过；`git diff --check` 无问题。
- 未执行：真实浏览器视觉验收、375px 窄屏溢出、Ruby 注音放大后重叠、模考顶栏在窄屏的拥挤情况、跨设备同步。
- 风险：`--reading-scale` 在 hydration 后才写入，首屏可能短暂以标准字号渲染再跳变；`.richtext` 若将来嵌套会重复缩放；模考顶栏新增按钮后窄屏可能换行。

## 补充：控件改为「三个递增 A」（同日，用户验收反馈）

- 反馈：练习页「Aa 特大」文字胶囊挤在进度文字后，不好看。改为三个大小递增的「A」（13/17/22px）单选组，当前档为白底主色，位于进度行最右；用户中心共用同一组件；严格模考顶栏仍用单个「Aa」循环按钮（去掉文字标签）。
- 测试：`vitest run` 44 文件 375 passed、`tsc` 无错误；web 容器已重建。真实浏览器视觉仍待用户验收。

## 补充二：改为「字号设置」按钮 + 对话框（同日，用户第二次反馈）

- 反馈：三个「A」也不好看。改为「字号设置」按钮（模考顶栏用「字号」），点击弹出对话框：带刻度滑轨（吸附 5 档，1–1.5×）、日文题目实时预览、「恢复标准」「完成」，Esc/点遮罩关闭。存储改为档位序号（旧版名称 standard/large/xlarge 自动映射）。ADR-0034 与 design-system 已同步。
- 测试：`vitest run` 44 文件 375 passed、`tsc` 无错误；web 容器已重建。窄屏底部弹层、预览与实际页面一致性、Ruby 重叠仍待浏览器验收。
