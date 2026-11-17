# Devlog · Floating Audio Dock + Transcript Panel（audio-player.md v1.1 落地）

日期：2026-11-17 · 分支：develop

## 范围

按用户新版《听力播放器 UI 设计规范 v1.1》重构练习页听力播放器，并实现向上展开的听力原文面板（Cue 同步、跟随播放、点击定位、权限门控）。规范原文已入库为 `docs/design/audio-player.md`（v1.1），`docs/README.md` 与 `docs/design/practice-interactions.md` 已挂引用。仅桌面端；移动端播放器、严格模拟播放规则、精听/AB 循环等不在本版范围（规范 §13）。

## 改动

### 文档
- 新增 `docs/design/audio-player.md`（v1.1 完整规范：布局、交互、权限、无障碍、边界）。
- `docs/README.md` 用户端 UI 行、`docs/design/practice-interactions.md` §视觉顺序 引用该规范。

### 后端
- `backend/app/api/practice.py`：抽出 `_feedback_gate`（原 feedback 门控逻辑不变），新增
  `GET /api/practice/sessions/{sid}/units/{suid}/transcript`——听力 cues 此前从未出现在任何学生端
  payload（`content.py` 公开响应恒剥离 `cues` 字段），本端点是唯一通路，且与 feedback 完全同一门控：
  immediate 模式该 Unit 提交后开放、end 模式会话正式结束后开放；未授权 409（`unit_not_submitted` /
  `feedback_locked_until_end`）、跨账号/不存在统一 404。响应含 unit 的 cue 材料
  （`material_id/kind/language/cues`），无 cue 材料返回空列表。
- 新增 `backend/tests/test_transcript_gate.py`（5 测试）：immediate 提交前密封且响应不含原文文本、
  提交后开放；end 模式提交后仍密封、finish 后开放；跨账号 404；无 cue 材料空列表；
  **提交后公开 unit 端点仍不泄漏 cues**（`/api/releases/{rid}/units/{uid}` 响应断言无 cues/原文文本）。

### 前端
- 逻辑层 `AudioDock/useAudioPlayer.ts`（替代原 `content/useAudioPlayer.ts`）：新增 ±5s skip、
  `playFrom`（定位并播放，供点击 Cue）、playbackRate、volume/mute、error 后 `retry()`（重载媒体）、
  Ended 后进度停在终点且再次播放从头开始；buffering 状态禁用播放钮防重复触发。
- UI 拆分（`app/features/content/AudioDock/`）：`AudioDock.tsx`（编排，`<audio>` 单实例常驻）、
  `AudioInfo`、`PlaybackControls`（48px 深樱主按钮 + ±5s）、`AudioProgress`（4px 轨道 14px 滑块、
  `--progress` 渐变填充、tabular-nums 时间）、`PlaybackSpeedSelect`（复用 Select compact：0.75×–1.5×）、
  `VolumeControl`（Popover + 滑杆 + 静音）、`TranscriptToggle`（文字+图标，锁定态显示
  「原文（提交后可查看）」并禁用）、`TranscriptPanel`、`TranscriptCueItem`、`icons.tsx`。
- 原文渲染复用 RichText 白名单：cue 的行内 `children` 包装为单段 doc 后走同一解析管线，零
  `dangerouslySetInnerHTML`，cues 不绕过白名单。
- 面板行为：`position: fixed` 向上展开、独立内部滚动、高度 `min(320px, 视口剩余)`（顶部不越界）；
  展开/收起不重排页面、不锁滚动、无遮罩；Esc 收起（非模态，无焦点锁定）；切组自动关闭并重取；
  当前 Cue 匹配 `start_ms <= t < end_ms`，Active 用浅樱底+深樱时间标签+左侧指示线+`aria-current`
  （不依赖颜色）；跟随播放默认开，用户 wheel/触摸/滚动键即暂停跟随，可开关恢复；无效时间戳 Cue
  渲染为不可点击文本（「时间未校准」），不猜时间；点击有效 Cue → `playFrom(start_ms)`。
- 权限 UI 锁定由 PracticePage 从服务端状态推导（immediate→本组已提交；end→会话已结束），后端门控
  仍是唯一授权边界；按钮锁定只是呈现。
- 样式：新 `_audio-dock.scss`（dock 80px、圆角 24、等宽 `.container` 内容盒、底部 20px、z-index
  15，页面内容 10 < dock/panel 15 < modal 20 < popover 60）；tokens 新增
  `--audio-dock-height/bottom/radius/shadow`、`--transcript-panel-height/radius`（原 64px dock token
  更新）；`global.scss` 移除旧贴底条样式（保留 `.audio-unavailable`），`.practice-shell` 底部预留改为
  dock 高 + 20px + 安全区；动效 160/220ms 并尊重 `prefers-reduced-motion`。
- `PracticePage.tsx`、dev 渲染 harness 改用 `AudioDock`（后者仅改导入与标签）。

## 测试结果（真实输出）

- 后端全量：`pytest -q` → **167 passed, 2 skipped**（skip 为本地缺 Canonical Archive.zip 的环境性
  skip，与本改动无关；含新增 transcript 门控 5 测试）。
- 前端全量：`pnpm vitest run` → **223 passed**（含新 AudioDock 19 测试：dock 基础 10 + transcript 9）。
- `pnpm typecheck` 通过；`pnpm build` 通过（含预渲染品牌 HTML、noindex SPA fallback、凭据泄漏扫描）。
- Docker 全栈重建：`docker compose build api web migrate` + `up -d`，migrate 正常退出，`:8080`
  冒烟：`GET /api/exams` 返回 105 套目录、未认证 `GET /api/practice/sessions/current` 正确 401
  （"authentication required"）、首页预渲染 HTML 正常。

## 后续调整（同日，用户实测反馈）

- **Active 高亮改纯字体色**：不用浅樱背景/指示线，段落文字与时间标签直接变深樱色。首版改动后用户
  仍观察到「只有时间标签变色」——静态夹具 + 容器真实 CSS 复现定位出根因：`.transcript-scroll p`
  （本给加载/空态文案写的规则）直接命中 cue 内 `.richtext-p`，直接规则压过祖先继承；已收窄为
  `> p` 只作用状态文案。
- **Dock 收窄 100px**：宽屏下 max-width = 内容容器 − 64px − 100px，窄视口仍跟随侧边距；面板同宽；
  `audio-player.md` §2.1 已记录。
- **去掉段落时间数值 + 压缩上下间距**：cue 不再渲染时间范围/「时间未校准」标签（时间戳仅用于高亮
  与点击定位，seekable 判定与降级逻辑不变）；`transcript-scroll` gap 与 cue padding 调小；
  `audio-player.md` §4.2 与布局示意同步。
- AudioDock 19 测试、typecheck、build 产物检查通过；web 容器每步重建，:8080 冒烟 200。

- **胶囊样式 + cue 段落去 margin**（用户再反馈）：dock 圆角改为胶囊全圆角（`--audio-dock-radius`
  999px，`audio-player.md` §2.1 已更新）；cue 内 `p` 去 `margin-bottom`（覆盖全局 `p` 规则）。
  AudioDock 19 测试、build 通过；web 容器重建，:8080 冒烟 200。

## 未执行 / 剩余风险

- 真实浏览器视觉走查未由 Agent 执行（等宽对齐、向上展开动效、跟随滚动、Range 样式跨浏览器）；
  已重建 :8080 交由用户实测，后续问题另行修复。
- Firefox/Safari、深色模式、200% 缩放未测（既有缺口，非本次引入）。
- 严格模拟播放权限、移动端播放器、Cue 段落循环/多音频版本为规范明确不做的范围。
- happy-dom 测试进程偶发卸载期 fetch 噪声为既有测试基础设施问题，未处理。
