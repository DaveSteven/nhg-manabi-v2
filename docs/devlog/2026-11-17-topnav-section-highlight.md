# 2026-11-17 · 练习/结果页高亮顶栏对应入口

问题：练习与结果页 URL 都是 `/study/practice/:id`，无论从专项还是从试卷进入，顶栏都不高亮（专项项为 `end` 匹配）。

改动：`TopNav` 新增 `NavSectionProvider`/`useNavSection`；`PracticeBreadcrumb`（练习与结果页共用）按 `topic` 声明归属——专项会话高亮「专项」，试卷会话高亮「试卷」，离开页面即清除；`routes/study.tsx` 提供 context。无 provider 时为空操作。试卷详情 `/study/exams/:id` 原本就高亮「试卷」。

测试：新增 2 例（两种归属）；tsc 通过，vitest 254 passed；浏览器未验证。

## 补充
吸顶后 `.site-header.is-stuck .header-row` 去掉边框色（仅保留背景、阴影与模糊）；纯样式，未跑浏览器验证。
