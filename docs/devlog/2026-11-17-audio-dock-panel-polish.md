# Devlog · 听力播放器与原文面板 UI 优化轮

日期：2026-11-17 · 分支：develop · 前置：`2026-11-17-audio-dock-transcript.md`

## 范围

按用户新一轮《听力播放器与原文面板 UI 优化》规范（Desktop Only）对 Audio Dock / Transcript
Panel 做最小改动优化；不触碰 Canonical Schema、音频引擎、提交判题、会话管理与原文权限规则。

## 改动

1. **面板尺寸**（Task 1）：默认 300px、最大 360px（token `--transcript-panel-height/-max-height`），
   视口不足自动收缩（沿用 `min(300px, 100vh - dock - bottom - 40px)`）；正文阅读宽度上限 800px
   在面板内居中；只滚动面板内部。
2. **视觉一体化**（Task 2）：`AudioDock` 重构为一个浮动组件——`position:fixed` 容器改纵向 flex，
   Transcript Panel 成为面板的在流上半部，`.audio-dock-bar` 是控制条；共用一层阴影、统一白色
   背景、外圆角（收起=胶囊；展开=顶部 20px + 底部胶囊，`overflow:hidden` 裁切），面板与控制条
   之间仅一条浅色分割线（`border-bottom`）。代码仍是 `AudioDock`/`TranscriptPanel` 两个组件。
   展开仍不改变页面高度/滚动位置（容器 fixed，向上生长）。
3. **Cue 展示**（Task 3 + 用户插话）：当前播放段落恢复**浅樱背景**（覆盖当日早前「仅变色」方案，
   文字保持墨色对比）；**时间标签维持不显示**（用户在规范下发后明确「时间标签还是不要」）；
   有效时间戳 Cue 可点击定位（权限模式约束不变），无时间戳段落照常展示、不伪造时间。
4. **排版**（Task 4）：面板标题 18px/600；正文 16px/400、行高 1.8；段落间距 12px；左右留白 24px。
5. **工具栏**（Task 5）：顶部为「听力原文 — 跟随播放 Switch — 收起(Chevron Down)」；新增 Token
   风格 `role="switch"` 组件（`follow-switch`，替代 Checkbox）；与播放器「原文」按钮共用同一
   expanded 状态。不新增翻译/字体调整功能。
6. **跟随播放**（Task 6）：逻辑保持——默认开启、新 Cue 高亮并平滑滚动入视区、用户
   wheel/触摸/滚动键即暂停跟随、Switch 可恢复；`prefers-reduced-motion` 下瞬移。
7. **遮挡与层级**（Task 7）：未增加页面底部 padding；面板高度受视口钳制不会越顶；层级仍为
   内容 < 浮动组件(15) < Modal(20) < Popover(60)；不锁滚动、无遮罩。

## 测试结果

- AudioDock 组件测试 **20 passed**（新增跟随 Switch 默认开/可切换断言；其余 19 项含原文门控、
  Active 段落、点击定位、无效时间戳降级、开合不重建音频等全部继续通过）。
- `pnpm typecheck` 通过；`pnpm build`（含预渲染/noindex/凭据检查）通过。
- web 容器重建，:8080 冒烟 200。
- **UI 截图**（验收用）：因页面需登录会话，采用容器内真实编译 CSS + 静态夹具渲染展开态截图
  （`/tmp/dock-after/after.png`，1280×800）：面板+播放器一体圆角/分割线/浅樱 Active/Switch/
  阅读宽度居中均符合；真实页面截图留待用户在 :8080 实测确认。

## 决策冲突记录

- 规范 Task 3「显示必要的时间信息」被用户随后一句「时间标签还是不要」覆盖——维持不显示。
- 规范 Task 3「浅樱背景」恢复，覆盖同日早前「仅变字体色」——以最新规范为准，文档已改回。

## 追加修复（用户截图反馈）

- **底部圆角异常根因**：展开态把胶囊横向半径写成 999px、纵向 40px，宽幅容器上相邻半径超出
  边长触发 CSS 缩放规则，椭圆弧被压成扁弧。改为横=纵=高度一半（40px 正圆角）。
- `.transcript-scroll` 去掉 800px 最大宽度（用户决定，正文随面板宽度，仅留内边距）；
  `audio-player.md` §3.3 同步。截图复验：底部正圆弧、正文满宽。20 测试、build 通过，
  web 容器重建冒烟 200。

## 选项对齐修复（用户截图反馈）

- 选项行 radio 与文字不水平居中：选项文字经 `.richtext > p` 渲染，全局 `p { margin-bottom: 12px }`
  把文字块撑高、相对 radio 偏上。`.option-row .richtext p { margin: 0 }` 修复，radio 加
  `flex: none`。web 全量 224 passed、build 通过，容器重建冒烟 200。

## 「已保存」状态移除（用户要求）

- 练习题号旁不再渲染 `save-saved`「已保存」徽标（saving/保存失败/冲突等状态保留）；自动保存
  行为本身不变。测试原以 `已保存` 文本等待自动保存完成，改为以 draft 请求发出为信号。
  web 全量 224 passed，容器重建冒烟 200。

## 中文对照 + 交互精简（用户追加要求）

- **中文对照开关**：核实原始数据确认每个听力组的 `translation` 字段是 `<p class="moj-trans">`
  中文段落列表、与日文字幕段落同序——转换器已把它收为 Unit 级 `release_explanations`
  （kind='translation', zh-CN），无需改数据管线。transcript 端点在同一权限门控下将其段落块与
  cues **按序号 1:1 配对**（数量不等则返回 null，绝不猜测/补齐），响应新增 `translation`
  字段；后端 7 项 transcript 测试含配对、end 模式密封、数量不齐降级。前端「中文对照」Switch
  仅在存在配对翻译时出现，默认关；开启后每条日文 cue 下方渲染中文行（13px/次要色，白名单
  RichText 渲染）。
- **移除「清除本题选择」按钮**（用户要求；换选其它选项仍可改草稿，行为不变），相关样式一并删除。
- web 225 passed、typecheck/build 通过；后端 169 passed + 2 skipped；api/web 容器重建冒烟 200。

## 「编辑中…」状态移除（用户要求）

- 题号旁不再渲染 `dirty`「编辑中…」（自动保存进行中的 `保存中…`、失败/冲突状态保留——它们需要
  用户感知）。web 225 passed、build 通过，容器重建冒烟 200。

## 未执行 / 剩余风险

- Firefox/Safari、深色模式、200% 缩放未测（既有缺口）。
- 收起态胶囊在面板打开→收起切换时的圆角过渡无动画（直接切换）；如需过渡另开任务。
- 测试对「一体化圆角/分割线」等纯视觉项无断言（CSS 层），依赖截图与人工走查。
