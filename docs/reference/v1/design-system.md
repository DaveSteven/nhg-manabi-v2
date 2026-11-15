# 设计系统「樱与墨」（学生端 nhg-manabi-web）

> 提炼自方案一 UI 改造（已归档：`docs/archive/ui-redesign-plan.md`）。token 实现统一位于 `nhg-manabi-web/src/styles/_base.scss` 的 `:root` 与 `html[data-theme="dark"]`。
> **admin 端不跟随本主题**，保持 AntD 默认配色（决策 D2，见 `docs/product/decisions.md`）。

## 设计原则

1. **三分樱七分墨**：樱花只做情绪点缀（streak/进度/热力图/庆祝），主体是墨色 + 和纸白的成熟工具气质，避免全站粉色。
2. **行为设计保留**：微交互与即时反馈（按压位移、答对动效、进度奖励感）是行为设计而非视觉皮肤，换肤不删。
3. **Token 纪律**：业务样式禁止硬编码 hex/rgba。允许的例外：token 定义值本身、真题扫描件白色内衬（规范要求字面白）、装饰印章内圈、双主题通用的阴影/遮罩 rgba。
4. **语义色不挪用**：`--correct`/`--error`/`--warn` 只服务反馈场景（答对/答错/时间提醒）；分类辨识用 `--chart-*` 或图标，不用反馈语义色。

## 页面布局与信息层级

以下用于学生端新增界面与局部调整，结合当前页面和任务选择，不要求每页套同一布局。配色、字号与组件合规之外，还需检查整页组合后的视觉效果。

- **先定主次**：先明确用户当前要完成的任务，再排列主要内容、主要行动和辅助信息。题干/文章优先于练习次数等元信息；收藏、设置和次级导航不抢主行动的视觉权重。遵循下方按钮权重规则。
- **按场景选择结构**：单题作答优先专注阅读；回顾场景根据跳题需要组织导航与详情；统计页遵循 D6 的图表与洞察布局。复用适合当前任务的现有页面骨架，不能因为有宽屏空间就给每页加侧栏，也不能把所有信息机械堆成同权重卡片。
- **宽度服务内容**：PC 优先，沿用现有页面容器和断点；列表/工作区可充分使用宽屏，长篇日文需保留舒适阅读宽度。窄窗口下明确列的堆叠顺序，保持主内容和操作可达；不新增移动端专项。
- **分组与留白**：相关信息靠近，不同区块用一致间距分组；优先通过位置、字号、字重和留白建立层级，再使用底色或分隔线。避免同一内容重复套卡、整圈边框和阴影堆叠，也不为填满画布增加无意义装饰。
- **新增元素检查整行**：标题、元信息、状态徽章、收藏和工具条共存时，明确各自的空间与对齐关系；允许辅助信息合理换行或移到次行，避免遮挡标题和操作。长标题、较大计数和按钮文案变化时仍应成立，不靠不断缩小字体补救。
- **内容真实且有层级**：用代表性的中日文、长题干/解析和实际数据量判断布局，不只看短占位文案。加载、空、失败等相关状态应保留清晰结构与必要行动；信息缺失时不留下突兀空壳或无意义数字。
- **状态与双主题**：hover、键盘焦点、选中、禁用应可辨；反馈不只依赖颜色。日间与夜间分别检查文字、卡片层次、图表和扫描件；具体 token 与对比度要求见下文。

视觉验收应查看实际渲染画面，检查层级、对齐、留白、密度、长文本和遮挡，不能仅凭 token 使用情况判断。执行方法与验证记录遵循 `/implement`；具体任务的布局取舍与检查范围记录在对应计划，避免在此累积页面改造历史。

## Token 体系

### 色板（日间基准值）

| 组 | token | 值/说明 |
|---|---|---|
| 基础 | `--ink` `--muted` `--surface` `--card` `--line` `--shadow` | `#2b2b33` / `#7a7580` / 和纸白 `#faf7f2` / 卡片白 / `#e6e3e0` / `#dfdbd7` |
| 主题 | `--primary` `--primary-dark` `--primary-soft` | 深樱 `#b94968` / `#93354f` / 淡樱 `#fbe3ea` |
| 点缀 | `--sakura` `--sakura-soft` `--sakura-dark` | streak/进度/热力图/花瓣专用 |
| 反馈 | `--correct/--error/--warn` 各配 `-dark` `-soft` | 松绿 `#2f7d4f` / 绯红 `#c73e3a` / 山吹茶 `#b98a1e`（降饱和） |
| 图表 | `--chart-vocabulary/grammar/reading/listening` | 缥 `#5d9bc4` / 抹茶 `#8aa646` / 藤紫 `#8f77b5` / 山吹 `#e8b042` |
| 特殊 | `--on-accent` `--overlay` `--progress-fill` `--progress-track` | 夜间强调底上的文字色 / 遮罩 / 进度条（季节彩蛋不覆盖数据元素） |

- **夜间色板原则**：暖黑分层（`--surface #1f1d23` < `--card #28262e`），用表面亮度差替代阴影表达层级；强调色同色相提亮，`--on-accent` 在夜间强调底上换深墨。完整值见 `_base.scss`。
- 兼容别名 `--blue`/`--green`/`--coral`/`--yellow` 仅存于 `_base.scss` 指向新语义 token，新代码一律用语义名。

### 几何与排版

- 圆角五档：`--r-xs` 8 / `--r-sm` 10 / `--r-md` 14 / `--r-lg` 18 / `--r-xl` 24（另允许 `50%` 与 `999px`；`border-radius: 0` 方角输入框为刻意保留）。
- 间距：`--sp-1`~`--sp-6`（4px 栅格）。字重三档：400 / 600（`--fw-medium`）/ 700。
- **字体双轨**：`--font-ui`（界面）与 `--font-serif`（内容：题干、真题文章、解析、译文；行高 1.8 + `letter-spacing: 0.02em`）。衬线用 Noto Serif JP（Google Fonts wght 400/700 + display=swap + preconnect；国内加载慢可换自托管子集）。
- 字号七档：`--fs-xs` 0.75rem → `--fs-base` 1rem → `--fs-2xl` clamp(1.75rem, 4vw, 2.5rem)，全站禁止散值。

### 容器宽度

**单一外壳 + 内部阅读列**（D18，修订废除 D17 的三级 token 体系）：

- **外壳唯一**：`.app-frame`（`_base.scss`）`min(1180px, 100%)` 是全站唯一页面宽度；所有页面随外壳铺满 1180，**新页面不得自定页面级宽度**（max-width/width 均禁止）。页面切换零宽度变化。
- **阅读列**：长文本流容器统一 `max-width: 40em`（`_richText.scss` 末尾集中定义），**仅限考试作答中**：`.exam-passage .html-content`（考试作答中的阅读文章）、`.question-area h2`（quiz 题干）。**回顾/复盘类页面随容器全宽、不限 40em**（`.review-shared-passage`、`.analysis-block`、`.bilingual-line > .html-content`；用户要求 2026-11-13：回顾卡内容不满行就换行显得局促）。另一例外：练习模式共通文章 `.exam-passage.practice-shared-passage` 随容器全宽、不限高（用户要求 2026-11-13；注意其 `max-height: none` 需高于 `.exam-passage` 420px 滚动帽的特异性）。选项按钮（`.options-grid`）不限宽、随容器（用户要求 2026-11-13）。只限宽文字流，不碰图片/表格媒体与短文本；精听解析 `.listening-explanation p` 保留 72ch（视觉等效）。
- **transcript 双栏**：`.with-translation .bilingual-line` 译文并排双栏（原文左 1.1fr、译文右 1fr），无译文单列；`$bpMd` 以下回退堆叠（`_responsive.scss`）。
- **路由过渡**：`RequireAuth` 内 keyed `<div className="route-fade">` 150ms fade-in（`_base.scss`），login 页不参与；`prefers-reduced-motion` 下禁用。
- 非页面容器（弹窗、卡片内限宽、媒体如 `.exam-image` 860px）不受此约束。

### 阴影与按压

| token | 用途 |
|---|---|
| `--shadow-rest`（`0 3px 0`） | 可按压实体（按钮、tab、选项、可点卡片）——**实投影 = 可以按** |
| `--shadow-soft`（`0 1px 3px`） | 静态容器（卡片、面板）——**弥散浅影 = 只是内容** |
| `--shadow-float` | 浮层（modal、下拉、tooltip、key-toast） |
| `--shadow-press` | active 按压态（配 `translateY(2px)`，`_press.scss` 统一实现；扁平控件只位移不加影） |

带色按钮的按压阴影一律用对应 `-dark` token。动效时长：按压 120ms / hover 150ms / 转场与判定 200~250ms / 庆祝 800~1500ms；只作用于 transform/opacity；全局尊重 `prefers-reduced-motion`。

## 表面处理规则（视觉收敛核心）

| 规则 | 适用 | 处理 |
|---|---|---|
| A 实体 | 可交互元素 | `--card`/`--surface` 底 + `--line` 边框 + 按压阴影 |
| B 内容 | 非交互信息块 | **只给底色**，分隔用 `border-bottom: 1px solid var(--line)` |
| C 染色 | soft 四色底 | **永远无边框**；强调用左侧 3px 实色竖条（accent bar） |
| D 纯边框盒 | 无底色边框盒 | 改判 `--surface` 内衬或统一空心样式 |

补充条款：
- **边框一律 `--line`**，不用边框颜色表达状态或层级——状态用 soft 底色、层级用徽章 + 位置表达；可交互控件的选中/强调态允许 `--primary` 描边。
- **容器不做渐变**（和纸白底上易显脏且夜间需另调）。
- **三层底色**：页面 = `--surface`；页面直接子元素（卡片/tab/搜索框）= `--card` 白底浮起；白卡内控件/面板 = `--surface` 内衬。夜间 `--card` 自动比 `--surface` 亮一档，无需另调。

## 提示块语义（accent-bar 类块的语义分配，D19；D20 修订 insight 壳与反馈容器）

规则 C 的「左侧竖条 + soft 底」壳此前被洞察结论、共通文章、试题解析、错误提示四种语义混用（6 个互不相干的 class 各自实现），用户无法从样式预判内容性质。语义分配如下，收敛为三个语义 class：

| 语义 | class | 处理 | 迁移来源 |
|---|---|---|---|
| 洞察/行动建议 | `.callout-insight` | **中性壳（D20）**：`--surface` 底 + `--line` 全边框 + 对称圆角，左 3px `--primary` 为唯一品牌锚点；正文 `--ink`，CTA `--primary-dark`。**仅用于插叙消息**（听力播放器提示、设备检测等状态消息）；stats 面板结论不使用提示壳（D20 验收前修订：数据自明，结论提示整体移除，行动入口集中在「学习概况」卡片） | `.stats-conclusion` |
| 错误/故障 | `.callout-error` | 左 3px `--error` + `--error-soft` 底（D19 壳不变），**必须带图标**（lucide 20px）；禁止无图标复用信息壳 | `.listening-device-check`、`.listening-exam-player.error` |
| 解析（教材内容） | `.analysis-block` | **弱化提示壳**：`--surface` 内衬底 + 小标签（「解析」，`--fs-sm --muted`）+ 衬线内容（U2 双轨制）；无彩色左条 | `.analysis-text`、`.practice-result-analysis`、`.listening-explanation` 三处统一 |

- **正文引用/共通文章中性化**：文章是"读的内容"不是"消息"，`.review-shared-passage`、richText `blockquote` 去彩色底，改 `--line` 左条 + 无彩色底（或 `--surface`）。转写/听读原文更进一步：`.listening-transcript`、`.reading-transcript` 为无左条 + `--surface` 内衬面板、四角圆角，不用 primary-soft 彩底也不加左条（用户要求 2026-11-13：左条直角不舒服→去左条）。另：`.callout-insight` 内的文字链 CTA 只作用于无 class 的裸按钮（`:not([class])`），带按钮 class（如听力播放器 `.primary-button`）保持实心样式，不被壳规则覆盖成透明底（用户要求 2026-11-13）。
- **负面洞察不变红**：「正确率下降 X 个百分点」等负面洞察保持 insight 壳（中性壳下自动满足），好坏由文案表达；`--error` 只留给真正的错误，防错误语义蔓延。
- **练习即时反馈拆两层（D20）**：容器 `.practice-inline-feedback` 中性壳（`--line` 边框 + 透明底，`--r-md` 圆角）；语义色只给信号头 `.practice-feedback-head`（`--correct-soft`/`--error-soft` 底 + `--correct-dark`/`--error-dark` 字 + lucide `CircleCheck`/`CircleX` 20px 图标，反馈不只依赖颜色）——答对用 `--correct` 语义色，不用 `--primary`；「正确答案：X」为容器内普通文本；`.analysis-block` 保持弱化壳。原则：**语义色/主题色块只给短信号，长内容区保持中性壳**。
- 实施范围：`_stats / _review / _examSession / _practiceResult / _listening / _examList` 六个样式文件 + 少量 TSX 类名；旧类名直接替换，日/夜两主题分别校验。

## 组件契约要点

- **按钮**：六变体 Primary / Secondary / Success / Danger / Outline / Ghost（规格见归档方案 §3.1）；样式统一收在 `_base.scss`；**同屏只允许一个实心 Primary**，其余主要行动降 Outline；尺寸 lg 52 / md 48 / sm 40，圆角 `--r-md`。
- **返回按钮**：统一走 `PageHeader`（44×44 圆形 icon-button；`text` prop 提供文字胶囊模式，当前无消费方）。
- **卡片**：标准卡 `--r-lg` + `--shadow-soft`；主打卡 `--r-xl`；内嵌面板 `--surface` 无阴影；浮层 `--card` + `--r-md` + `--shadow-float`。
- **答题选项**：默认 `--card` + `--line` 边框 ≥52px；选中 `--primary` 描边 + soft 底；判定正确/错误切对应底色 + ✓/✗；序号徽章 `--r-xs`，键盘模式下显示键帽提示（`.keyboard-active`）。
- **tab**：选中态统一 `--primary` 实底 + `--on-accent` 字 + `--primary-dark` 按压阴影；分类辨识交给图标，禁止反馈语义色/多色实底。
- **badge**：`book-badge` 全站一款中性（`--surface` 底 + `--muted` 字）；状态 chip 999px + soft 底；错次计数徽章 `--error` 白字。
- **图标**：lucide-react 描边 2，尺寸阶梯 16（行内）/ 20（按钮）/ 22~24（标题、入口卡）。
- **Tooltip**：`--fs-sm`、`--card` 底、`--r-sm`、`--shadow-float`，延迟 300ms 出现、立即消失（`components/Tooltip.tsx`）。

## 主题机制

- **默认日间，手动切夜间**（`ThemeToggle`，localStorage `manabi_theme`）；"跟随系统"已移除（决策 D4）。
- **季节彩蛋**：`main.tsx` 按月份给 `<html>` 挂 `data-season`（春樱/夏抹茶/秋红叶/冬雪青），只覆盖 `--sakura` 系点缀色，仅 light 主题生效；**季节不换数据元素**（进度条/图表色恒定）。
- **夜间硬规则**：真题图片/扫描件保持白色内衬，禁止 `filter: invert`；玻璃拟态底用 `color-mix(var(--card))` 自动跟随。
- 对比度：正文 ≥ 7:1、交互文字 ≥ 4.5:1，日/夜两套 token 值分别校验。

## 遗留与未确认

- `.subject-tabs`（旧）与 `.subject-library-tabs`（现用）两组件样式未合并（选择器不同，选中态规则已一致，视觉无差异）；组件级合并涉及改 JSX，待首页重构时机。
- 双主题全页面人工走查待用户确认（U6/U7 验收收尾）。
- PWA manifest 未建；印章 logo（`BrandMark` 组件 + `public/favicon.svg`）已就位，PWA 图标待 manifest 后补。
- 未来跨科目混排视图（如搜索结果）如需分类辨识：走 12px `--chart-*` 小圆点规则，badge 本身保持全站一款。
