# Select 与 Popover 组件规范 v1.1

> v1.1（2026-11-16）：Trigger 改为胶囊风格；新增 Large 尺寸（备用，当前无页面使用）。首页顶栏等级选择使用默认尺寸（44px）。

> 状态：2026-11-16 用户给出设计要求，本阶段落地。归属 `design-system.md` §9（按钮和交互状态）的表单控件部分，色彩/圆角/动效 Token 沿用该文档与 `tokens.scss`。
> 本阶段范围：**Select Trigger、Single Select、Grouped Select、Searchable Select 及配套 Popover**。多选、可创建选项、虚拟滚动不在本阶段。

## 1. 为什么不用原生 `<select>`

原生下拉的弹层由系统绘制，无法统一圆角、选中态、动效和位置，在 macOS/Windows/移动端表现不一致，也不能做分组样式与搜索。本项目自研一套轻量组件（不新增第三方依赖，避免为单一控件引入 Radix/Floating UI；如后续需求显著复杂化再另写 ADR）。

## 2. 视觉规格

| 组件 | 设计要求 |
|---|---|
| Select Trigger（默认） | 高度 44px，**胶囊圆角（999px）**，白色背景，轻边框，右侧下拉箭头 |
| Compact Select | 高度 36px，胶囊，用于工具栏、密集筛选 |
| Large Select | 高度 52px，胶囊，字号 16px，用于需要强调的位置（备用，当前未使用） |
| Popover | 圆角 16px，白底，轻阴影，内边距 8px |
| Option Item | 高度 42px，圆角 10px，左右内边距 12px |
| Selected | 浅樱底色 `#F6E8EC`，深樱文字，右侧对勾（不只靠颜色表达） |
| Hover | 柔和暖灰背景（`--color-surface-subtle`），不使用明显彩色边框 |
| Focus | 清晰的品牌色焦点环（2px，`--color-primary`，偏移 2px），Trigger 与键盘高亮项均可见 |
| Animation | 160–200ms 淡入 + 轻微位移（4px）；`prefers-reduced-motion` 下取消 |

深樱文字取 `--color-primary-hover`（`#a53c5b`），在 `#F6E8EC` 上对比度约 5.4:1，满足 AA；品牌主色 `#b94968` 在该底色上不足 4.5:1，不用于文字。

禁用态：Trigger 与 Option 降低不透明度，Option 不可聚焦选中；`aria-disabled` 暴露给辅助技术。

**变体**：`variant="outlined"`（默认，白底+轻边框）与 `variant="text"`（Text 模式：静止时无背景、无边框，字重 600；悬停/展开时显示暖灰底，键盘焦点仍有品牌色焦点环，不依赖边框传达可点击）。首页顶栏的等级选择使用 Text 模式。

**宽度**：Trigger 未设置 `width` 时跟随内容宽度（无最小宽度）；需要固定或撑满时通过 `width` 指定（数字为 px，或 `100%`）。Popover 宽度不小于 Trigger 与 120px 中的较大者，并随最宽选项扩展。

## 3. Popover 与 Modal 是不同组件

| | Popover（本组件） | Modal（对话框） |
|---|---|---|
| 用途 | 选项浮层、轻量菜单 | 需要用户专注完成的任务（编辑资料、确认） |
| 遮罩 | **无遮罩** | 有遮罩，阻断背景 |
| 关闭 | 点击外部、`Esc`、选中后（单选）、`Tab` 离开 | 显式按钮、`Esc`、点击遮罩（视内容而定） |
| 焦点 | 单选 Select 焦点留在 Trigger；Searchable 焦点进入搜索框，关闭后回到 Trigger | 焦点陷入对话框 |

规则：

1. Popover **不得被父容器裁剪**：渲染到 `document.body` 的 Portal，`position: fixed`，不受祖先 `overflow: hidden/auto`、`transform`、`z-index` 堆叠上下文限制。
2. Popover **自动避让视口边缘**：下方空间不足且上方更大时翻转到上方；水平方向夹紧在视口内（保留 8px 边距）；高度受可用空间限制，超出时内部滚动。滚动/缩放/内容高度变化（搜索过滤）时重新定位。
3. 在 Modal 内使用 Select 时，`Esc` 先关闭 Popover，不会连带关闭 Modal。
4. Popover 宽度默认不小于 Trigger 宽度；可设最小宽度，不超过视口。

## 4. 变体与行为

### 4.1 Single Select
- Trigger 为 `button`，`role="combobox"`，`aria-haspopup="listbox"`，`aria-expanded`，`aria-controls`。
- 列表 `role="listbox"`，项 `role="option"`，选中项 `aria-selected="true"`。
- 打开时高亮当前选中项（无选中则第一项）并滚动到可见。
- 键盘：`Enter` / `Space` / `↓` / `↑` 打开；打开后 `↑ ↓` 移动高亮（跳过禁用项），`Home/End` 首尾，`Enter`/`Space` 选中并关闭，`Esc` 关闭，`Tab` 关闭；Trigger 上直接输入字符做首字母快速定位。
- 选中后焦点保持在 Trigger。

### 4.2 Grouped Select
- 选项按组给出（`{ label, options[] }`），组标题 `role="group"` + 可见标题（12px 次要色，不可选，不参与键盘高亮）。
- 键盘移动跨组连续。

### 4.3 Searchable Select
- Popover 顶部为搜索框（`type="search"`，`aria-label`），打开即聚焦；输入按 label 不区分大小写子串过滤，分组下无匹配项时整组隐藏。
- `↑ ↓ Enter Esc` 在搜索框内操作列表；无结果显示「无匹配项」状态，不可选中。
- 关闭后清空搜索词，焦点回 Trigger。
- 中文输入法组合输入期间（`isComposing`）不响应 `Enter` 选中。

## 5. 数据形状

```ts
type SelectOption = { value: string; label: string; disabled?: boolean };
type SelectGroup  = { label: string; options: SelectOption[] };
// items: SelectOption[] | SelectGroup[]
```
「全部」等空值使用 `value: ""` 的真实选项，不依赖浏览器空选择语义。

## 6. 无障碍与表单

- Trigger 必须有可访问名称：`aria-label` 或 `aria-labelledby`（可见标签用 `<span id>` 关联，不再用 `<label>` 包裹）。
- 选中状态不只靠颜色：对勾 + `aria-selected`。
- 触控目标：Trigger 36px（Compact）/ 44px（默认）/ 52px（Large）；Option 42px。
- 移动端沿用 Popover，不做底部抽屉（保持一套交互）。

## 7. 验收

- 视觉：尺寸/圆角/选中/悬停/焦点/动效与 §2 一致；顶栏的默认尺寸选择器不撑高导航行。
- 行为：§4 键盘与关闭规则；Modal 内 `Esc` 只关 Popover；祖先 `overflow:hidden` 不裁剪；窄视口与靠近底边时翻转/夹紧。
- 工程：定位逻辑为纯函数并有单元测试；Select 全变体有交互测试；现有页面的原生 `<select>` 全部替换。
