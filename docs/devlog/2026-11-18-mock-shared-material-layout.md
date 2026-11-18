# 2026-11-18 · 模拟考试共享材料题统一布局（ADR-0021）

## 范围
用户提出「共享材料统一布局」方案；评审（对照本机库数据）后用户确认「按修订版实现」。仅模拟考试页，普通/专项练习页不变；不改后端与数据。

## 数据依据（本机 current release）
- 信息检索 105 个 Unit 材料几乎全是纯图片，旧 `usesSplitLayout` 要求文字材料 → 退回上下堆叠（問題14 截图问题）。
- 短篇组 277 个 Unit、每个 2–3 题；中/长篇 2–4 题；综合 61 个（48 个双材料 A/B）。
- 读解选项可见字数中位数 27–39、P90 36–60；信息检索中位数 21、P10 3（人名）。

## 改动
- `SharedMaterialLayout`：新增 `layoutModeOf`（standalone / shared-material / cloze，按材料结构，含音频即 standalone）；`adaptive` 模式下文字或图片材料都分栏；「放得下全显示，放不下才切换」——布局前加 `is-measuring` 全部显示测量右栏高度，与「屏高 − 面板 Sticky top − 24px」比较，40px 回滞，监听 resize 与 ResizeObserver；题号条增加已答/标记状态（含读屏文本）；面板内点击/聚焦即激活该题并回调 `onActiveChange`。删除 `flow` 属性。
- `mockModel`：删除按题型名的 `isFlowType`；`split` 改用 `layoutModeOf`；新增 `richTextLength`、`optionColumns`（面板内 ≤12 字、整宽 ≤24 字才 2×2）。
- `ExamPhaseBody`：选项列数按规则加 `is-grid`；传入 `adaptive`/`chipState`/`onActiveChange`；答题卡跳转到 Sticky 面板中的题时滚动到 Unit 顶部；滚动监听只认面板中的激活题。
- `MaterialDisplay`：`imageZoom` 时图片为按钮，打开页内 `ImageViewer`（适应宽度/原始大小、Esc 关闭），位于考试状态栏之下。
- `_exam.scss`：58/42 与纯图片 62/38 栅格；`is-fit`/`is-measuring` 显示规则；题号条状态；A/B 在材料栏内上下排列；图片查看器；`.exam-options` 默认单列、`is-grid` 才两列；删除 `.is-flow`。
- 文档：ADR-0021、决策表 P-024、ADR-0018 标注模考页由 0021 修订、`docs/design/mock-exam-ui.md` 布局段更新。

## 测试（实际执行）
- web `vitest`：36 文件 / **309 passed**。新增/改写：`layoutModeOf` 按材料判定（含纯图片、听力）；短篇组与长篇在放得下时都全显示、无题号条；模拟高面板 → 切换 + 已答题号「1 已作答」+ 切换后答案保留；纯图片材料分栏 + 查看器开关与 Esc；长选项单列；`optionColumns`/`richTextLength` 单元测试。`tsc --noEmit` 无输出；`npm run build` 通过；`git diff --check` 通过。stderr 中的 `ECONNREFUSED` 噪音在改动前已存在（stash 后同样出现）。
- 真实环境（Docker web 重建 2 次，内置浏览器，本机测试账号 docker-e2e 放弃旧测试模考后新开 N2 2026-07 模考）：
  - 1440×900：問題10 五篇均 `is-fit`、栏宽 673/487、选项单列、面板 sticky；問題11（2 题合计约 860px）、問題12、問題13 为 `is-switch` 带题号条；問題14 为 `is-image-material` 719/441，第 70 题人名选项 2×2、第 71 题单列，因合计 785px > 776px 进入切换。
  - 1440×1300：問題12 自动变为 `is-fit` 两题全显示；900 宽：上下堆叠、面板 static、全部显示。
  - 大图查看器打开后倒计时仍可见，Esc 关闭；答题卡点第 60 题 → 抽屉关闭、所在 Unit 顶部停在状态栏下（top 100px）、题号 60 激活；作答后题号显示「60 已作答」，滚动后当前题仍为 60。
  - 修复走查中发现的问题：`--sticky-offset` 是未求值的 `calc()`，改为读取面板解析后的 Sticky `top`（100px）。

## 未执行 / 风险
- 视觉只做了截图抽查，未逐屏人工走查；Firefox/Safari、触屏放大手势未测。
- 图片宽高未入库，图片加载完成前材料栏会位移一次。
- 字数阈值（12/24）按 15px 正文与当前栏宽估算；问题14 这类处于阈值附近的 Unit 在不同屏高下会在全显示/切换间不同（属预期）。
- 第 70 题题干开头多出「70」属内容问题，未处理。未推送、未部署。
