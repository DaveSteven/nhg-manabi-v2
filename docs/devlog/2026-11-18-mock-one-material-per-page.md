# 2026-11-18 · 模考共享材料「一份材料一页」（ADR-0023）

## 范围
用户再次给出「一份材料一页 + 右侧问题切换」方案。与 ADR-0021 第 3 条冲突（放得下全显示），以用户最新决定为准并新增 ADR-0023。仅模考前端。

## 改动
- `SharedMaterialLayout`：adaptive 模式恒为一次一题，新增 `panel-pager`（上一题/第 N 题 · i/n/下一题，末题为「下一篇」）、`initialActive`、`onNextMaterial`；删除测量/回滞与 `chipState`；填空题切题仅在 Slot 不可见时滚动。练习页路径不变。
- `mockModel`：`ExamGroup.paged`；材料位置本机记忆。
- `ExamPhaseBody`：共享材料大题按 Unit 分页，底部上一篇/下一篇；记住各材料当前题；答题卡跳转定位到 Unit + 题。
- `_exam.scss`：pager 样式、当前题淡樱底，移除 fit/measuring。
- 文档：ADR-0023、P-026、ADR-0021 标注、`mock-exam-ui.md`。

## 测试（实际执行）
- web `vitest` 36 文件 / 316 passed（新增：一次一个材料 + 题/篇切换并恢复答案与当前题；答题卡跳转到材料与题；单题无 pager）；`tsc --noEmit` 无输出；`npm run build` 通过。
- 未执行：真实浏览器/Docker 走查（問題9–14 实测、Slot 联动视觉、图片放大）、后端测试（未改）。

## 风险
- 文法填空 Slot 联动沿用既有逻辑，仅有单测覆盖，未在真实页面核对；Sticky 与顶部 Header 的视觉未验证。
- 材料位置仅存 localStorage。
