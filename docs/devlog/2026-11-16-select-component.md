# devlog · 2026-11-16 · Select 与 Popover 组件

## 范围
用户给出 Select 设计要求（Trigger 44px/12px 圆角、Compact 36px、Popover 16px 圆角/8px 内边距、Option 42px/10px、选中浅樱 `#F6E8EC`+深樱文字+对勾、悬停暖灰、品牌色焦点环、160–200ms 动效），并强调 Popover 与 Modal 是不同组件（无遮罩、点外部/Esc 关闭、避让视口、不被父容器裁剪）。本阶段统一设计并实现 Select Trigger、Single、Grouped、Searchable 与配套 Popover。

## 改动
- 文档：新增 `docs/design/select-spec.md`（视觉规格、Popover vs Modal、三种变体行为、键盘/ARIA、验收）；`design-system.md` 增 §9.5 并链接；`docs/README.md` 索引。
- 组件（`apps/web/app/components/select/`）：`placement.ts`（纯函数：下方放不下且上方更大则翻转、水平夹紧、高度封顶）；`Popover.tsx`（portal 到 body + `position:fixed`、无遮罩、点外部/Esc 关闭、滚动/缩放/内容变化重新定位、Esc 用 capture + stopPropagation 只关自己）；`Select.tsx`（combobox 触发器 + listbox；键盘 ↑↓/Home/End/Enter/Space/Esc/Tab、首字母定位、禁用项跳过、分组、搜索含 IME 组合输入保护）；`_select.scss`。键盘焦点环仅在键盘导航时显示（鼠标为暖灰悬停）。
- 替换应用内全部 5 处原生 `<select>`：顶栏等级（Compact）、用户中心等级、试卷列表 等级/年份、试卷大纲 反馈方式；删除对应旧样式；标签改为 `aria-labelledby` 关联的 `<span>`。
- 开发用：`/study/dev/select` 画廊（`VITE_DEV_TOOLS=1` 才渲染），用于目检各变体、overflow:hidden 容器、页面底部翻转。

## 决策
- 自研而不引入 Radix/Floating UI：避免为单一控件加依赖；若后续需求（多选、虚拟滚动等）显著复杂化再写 ADR。
- 深樱文字用 `--color-primary-hover #a53c5b`（在 `#F6E8EC` 上约 5.4:1）；主色 `#b94968` 在该底色上不足 4.5:1，不用作文字。
- 移动端沿用 Popover，不做底部抽屉。

## 测试（真实结果）
- `placement.test.ts` 8 例；`Select.test.tsx` 21 例（Single/Grouped/Searchable、portal 不被 overflow 裁剪、无遮罩、Esc 不穿透到 Modal 的 Esc 处理、靠近底部翻转并封顶、IME Enter 不选中、禁用等）。
- 变异检查：去掉 Popover 的 `stopPropagation` 与 Select 搜索框的空格保护，对应测试均失败，随后已还原。
- 既有测试迁移到新组件（`test/select.ts` 的 `chooseOption`）。typecheck 通过；vitest **21 文件 / 184 passed**；`pnpm build` 与产物检查通过（stderr 仍有既知 ECONNREFUSED 噪声）。
- 真实浏览器：dev 画廊目检 Single/Compact/Grouped/Searchable/Grouped+Searchable/overflow 容器/底部翻转；Docker 容器内真实页面——顶栏紧凑选择、试卷列表等级/年份（选 2018 → URL `?level=N4&year=2018`、列表过滤、浮层关闭、焦点回触发器）。

## 未做 / 风险
- 未测：Firefox/Safari、触屏、屏幕阅读器实际朗读、375px 下的浮层、深色模式；无多选/创建选项/虚拟滚动。
- 搜索项过多（上千）时无虚拟化；当前最大场景为约 20 个年份。
- Select 目前仅 Single/Grouped/Searchable 在画廊与测试中使用，应用内尚无分组或搜索的真实用例。
- 测试学生等级已改回 N5。
