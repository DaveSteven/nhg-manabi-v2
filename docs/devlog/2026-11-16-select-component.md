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

## 续：胶囊风格与 Large 尺寸（同日，用户指示）
- Select Trigger 全部改为胶囊（`--radius-pill`）；新增 `size="large"`（52px、16px 字号，与 52px 头像同高），首页顶栏等级选择改用 Large；Compact(36)/默认(44) 保留且同为胶囊。Popover 16px 圆角、Option 10px 圆角不变。`select-spec.md` 升至 v1.1，尺寸表增 Large。
- 测试：typecheck 通过；vitest 21 文件 / 184 passed（纯样式改动，未新增断言）；`pnpm build` 通过；容器内浏览器目检首页顶栏 Large 胶囊 + 弹层。
- 未测：375px 下 Large 选择器与头像在顶栏的换行表现；画廊页新增 Large 示例但未逐一目检其余胶囊变体。

## 续：首页顶栏改用默认（normal）尺寸（同日，用户指示）
- 顶栏等级选择由 Large 改回默认 44px 胶囊；Large 组件变体保留为备用（当前无页面使用），`select-spec.md` 同步说明。
- 测试：typecheck 通过；vitest 21 文件 / 184 passed；web 容器重建后浏览器截图确认。

## 续：触发器宽度跟随内容（同日，用户指示）
- 去掉 Trigger 的各尺寸 `min-width`，未设置 `width` 时宽度由内容决定；新增可选 `width` 属性（数字为 px，或 `100%`）。Popover 的最小宽度默认 120px（`popoverMinWidth` 可改），仍随最宽选项扩展。`select-spec.md` 增「宽度」说明。
- 副作用：触发器宽度会随当前选中项文字变化（如「N4」78px、「全部」88px），选项文字长度差异大时宽度会跳动；需要稳定宽度的位置应显式设置 `width`。
- 测试：新增 1 例（默认无内联宽度、数字与 `100%` 生效）；typecheck 通过；vitest 21 文件 / 185 passed；容器内浏览器实测宽度如上。

## 续：Text 模式（同日，用户指示）
- `Select` 新增 `variant="text"`：静止时无背景、无边框（字重 600），悬停/展开显示暖灰底，键盘焦点环保留；其余行为与 outlined 相同。首页顶栏等级选择改用 Text 模式。`select-spec.md` 增「变体」说明，开发画廊增 Text 示例。
- 取舍：悬停/展开时会出现浅灰底，作为「可点击」的唯一提示；若要求任何状态都完全无底色，需另行确认。
- 测试：新增 2 例；typecheck 通过；vitest 21 文件 / 187 passed；容器内浏览器目检静止、展开状态。未测深色模式与手机宽度。

## 续：Text 模式完全无底色（同日，用户指示）
- Text 模式去掉悬停/展开时的暖灰底：静止、悬停、展开三个状态背景与边框都是透明，仅靠箭头（展开翻转）、手型光标与键盘焦点环表达可交互。样式用 `.select-trigger.select-trigger--text` 提高优先级，避免被基础的 `:hover`/`.is-open` 规则覆盖。`select-spec.md` 同步。
- 验证：容器内浏览器在悬停且展开状态下读取计算样式，`background` 与 `border-color` 均为 `rgba(0,0,0,0)`（边框宽度仍占 1px，布局不抖动）。vitest 21 文件 / 187 passed。未测深色模式。

## 续：Text 模式悬停/展开变主题色（同日，用户指示）
- Text 模式悬停与展开时，文字与箭头变为 `--color-primary`（`#b94968`），背景与边框仍透明；静止为墨色文字 + 灰箭头。`select-spec.md` 同步。
- 验证：容器内浏览器展开状态读取计算样式——`color` 与箭头均为 `rgb(185,73,104)`，背景透明；静止状态为 `rgb(43,43,51)`/灰。真实鼠标悬停态由 CSS `:hover` 规则承担，未单独用真实鼠标悬停截图验证（展开态与悬停态走同一条规则）。纯样式改动，无新增自动化测试；`pnpm build` 通过。

## 续：Popover 最大高度 250px 与自定义滚动条（同日，用户指示）
- Popover 高度上限 250px（`popoverMaxHeight` 可改，默认 250），选项列表在内部滚动，搜索框固定在顶部；`computePlacement` 新增 `maxHeight`，且用「封顶后的高度」判断下方是否放得下（避免自然高度很大时无谓翻转）。
- 滚动条：8px 命中区（可见 4px）、胶囊圆角、无轨道、樱色半透明滑块（悬停加深），`overscroll-behavior: contain`。
- 过程发现：第一版同时设置了标准的 `scrollbar-width/scrollbar-color` 和 `::-webkit-scrollbar`，Chrome 在设置标准属性后会忽略 WebKit 伪元素，实测列表 `offsetWidth-clientWidth=0`（macOS 叠加滚动条，样式未生效）。改为只在 `@supports not selector(::-webkit-scrollbar)`（Firefox）下使用标准属性后，实测宽度 8px，滚动条滑块可见。
- 测试：placement 新增 3 例、Select 新增 2 例，并更新原「靠近底部翻转」用例的高度期望（300→250）；typecheck 通过；vitest 21 文件 / 192 passed；`pnpm build` 通过。容器内真实页面（年份筛选 17 项）：popover 实高 250px，列表 790px 内容在 232px 内滚动，滚动条可见。
- 未验证：Firefox 的 `scrollbar-color` 近似效果、Safari、深色模式、触屏滚动。

## 续：历年试卷页去掉等级筛选（同日，用户指示）
- `/study/exams` 只保留「年份」筛选；等级跟随备考等级（登录读资料、访客读本地偏好，顶栏选择器可切换），未设置等级则显示全部。年份选项只含当前等级有的年份；该等级无试卷时提示「暂无 N? 已发布试卷，可在右上角切换备考等级」。旧链接中的 `?level=` 被忽略；删除了「首次把偏好种入 URL」的逻辑。`page-structure.md` 与 M2.2 计划表同步。
- 取舍：访客没有顶栏等级选择器，因此只能看到全部等级（或此前本地存过的偏好）；如需访客也能按等级筛选，需要另行决定入口。
- 测试：ExamList 测试改写为 5 例（无等级筛选、年份筛选与参数清理、跟随等级且年份选项只含该等级、该等级无试卷提示、链接）；typecheck 通过；vitest 21 文件 / 194 passed。容器内浏览器：页面只有年份筛选，旧 `?level=N1` 被忽略，改顶栏等级后列表随之变化。测试学生等级已改回 N5。

## 续：访客等级选择器 + 历年试卷年份分行胶囊（同日，用户指示）
- 访客也有顶栏备考等级选择器（含「全部等级」选项，等级存 localStorage）；已登录学生没有「全部等级」（资料必有等级）。`useLevel` 的访客等级改为 `localStorage + 发布订阅 + useSyncExternalStore`，顶栏与各页面共用同一份状态——此前每个组件各持一份 `useState`，访客在顶栏改等级后页面不会跟着变，这是引入访客选择器前必须修的缺陷。新增 `clearLevel`（仅访客）。
- 历年试卷列表：按年份分行、最新年份在前，每行两栏——左年份，右该年各会期的胶囊卡片（月份升序）。设置了备考等级时胶囊只写月份；未设置时附等级标签，同一年同月多个等级各占一个胶囊。胶囊的可访问名称为完整标题（如「2025年12月 N2」）。删除旧 `.exam-list/.exam-row/.exam-title` 样式；`page-structure.md` 同步。
- 测试：ExamList 重写为 7 例（年份行排序与月份顺序、等级标签仅在未设等级时显示、无等级筛选、年份筛选与参数清理、跟随等级且年份选项只含该等级、该等级无试卷提示、访客在顶栏改等级列表即时变化）；header 新增 2 例（访客选择器与「全部等级」、已登录无「全部等级」）。typecheck 通过；vitest 21 文件 / 197 passed；`pnpm build` 通过。
- 浏览器（容器）：N2 学生看到 `2026 ｜ 7月`、`2025 ｜ 7月 12月` …，2020 只有 12月；点 2025 年 12月胶囊进入 `/study/exams/JLPTGO-N2-2025-12`；375px 下两栏保持、胶囊换行正常。**访客状态未在真实浏览器里操作**（需要先退出登录），由单元测试覆盖。
- 未测：深色模式；胶囊在「未设等级」时多等级并排的视觉密度。

## 续：胶囊块级铺满、月份列对齐、题数（同日，用户指示）
- 胶囊改为块级（`display:flex`）铺满所在列；列由数据推导而不硬编码月份：当月份种类 ≤ 4 且同一行没有同月多份试卷时，每个胶囊落在「自己月份」那一列（如只有 12月 的 2020 年对齐到其它行的 12月 下），否则按两列顺序排列；只有一种月份时单列铺满。
- 胶囊内文字左对齐，右侧显示试题数量（`96 题`，次要色、等宽数字）。`GET /api/exams` 新增 `question_count` = 当前发布 release 中**可练习 Unit**（`conversion_status='complete'`）里的题数，与大纲各 Unit 题数之和一致（被隐藏的 needs_review Unit 不计入）。
- 前端 DTO：把 outline/layers 与列表共用的字段拆为 `ExamHeadSchema`，只有列表行（`ExamSummarySchema`）要求 `question_count`；契约夹具 `exams-list.json` 的 `question_count` 取自同一份 `exam-outline.json` 夹具各 Unit 之和（14）。
- 测试：后端 `test_content_queries` 断言列表题数 == 大纲 Unit 题数之和（3），后端全量 162 passed + 2 skipped；前端新增/调整 ExamList 用例（列对齐、单列、题数在右侧），vitest 21 文件 / 200 passed；typecheck、build 通过。
- 真实验证（容器，105 套）：`JLPTGO-N2-2025-12` 列表题数 101，与大纲求和 101 一致；全库题数范围 67–107；页面截图确认文字靠左、题数靠右、2020 的 12月 对齐在第二列。
- 未测：未设等级时多等级同月的并排观感、手机宽度下题数是否挤压月份、深色模式。无 Alembic 迁移（只读查询）。

## 续：去掉年份行分隔线（同日，用户指示）
- 历年试卷的年份行不再有分隔线，行距由 `padding: var(--space-2) 0` 控制（原 16px 上下内边距 + 分隔线）。纯样式改动，无新增测试；`pnpm build` 通过；容器内截图确认。未测手机宽度与深色模式。
