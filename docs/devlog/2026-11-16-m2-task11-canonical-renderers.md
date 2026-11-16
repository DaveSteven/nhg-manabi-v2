# Devlog · M2.2 Task 11（上）· Canonical Unit/RichText/音频渲染器

**日期：** 2026-11-16
**范围：** M2.2 Commit 3（`feat(web): implement canonical unit renderers`）：中性 view model、RichText v1 白名单渲染器、共享材料展示（含 A/B 双文）、音频播放器与固定底部 dock、dev 渲染管线 harness、真实浏览器音频冒烟。

## 改动内容

1. **`features/content/viewModel.ts` + `toViewModel.ts`**：中性渲染模型（VmUnit/VmMaterial/VmQuestion/VmOption）；`prompt=null` 合法（看图/听力题）不过滤；服务端 `printed_number`/`position` 原样透传，严禁索引重建；重复题 id/选项 id 抛可诊断 `ViewModelError`；音频材料经 `release_id+asset_id` 解析媒体 URL（Commit A 契约），无资产→显式 `unavailable`。
2. **`richtext/schema.ts`**：`jlptgo-richtext-v1` zod 白名单（block: paragraph/heading/list/table/image；child: text(marks underline/bold/italic)/ruby/slot(slot_id)/break），`strictObject`——未知节点/多余属性一律解析失败。形状对照 Canonical 规范 §5 与真实样本核实（当前样本仅用 paragraph/text/slot/bold；ruby/list/table/image 按规范实现，ruby 形状标注为 provisional）。
3. **`richtext/RichText.tsx`**：递归安全渲染，**零 `dangerouslySetInnerHTML`**；未知/畸形节点与超深嵌套（>32 层）→ 显式「不支持内容」状态 + 诊断回调；slot 完整性对照 unit.slot_ids——文档内重复 slot 或不属于本题组的 slot → 显式错误态（`role=alert`），绝不按视觉顺序猜测。
4. **`MaterialDisplay.tsx`**：每 Unit 共享材料渲染一次；衬线阅读排版（`--font-serif-reading` 系统衬线栈、行高 1.8、保留全角空格/缩进、无 NFKC）；A/B 双文用 `comparison_a/b` role 区分（宽屏并排/窄屏堆叠）；图片材料为带 asset_id 的占位态；音频材料挂载点（URL 就绪 / 显式不可用两态）。
5. **`AudioPlayer.tsx` + `useAudioPlayer.ts`**：固定底部 dock（每页唯一实例），播放/暂停、拖动进度（Range input，clamp 到时长）、缓冲/失败显式状态（文字+图标非仅颜色）、失败替换控件不留下死按钮；HTMLAudioElement 仅在浏览器生命周期引用（预渲染不触碰）；页面壳预留 `--audio-dock-height + safe-area`（`.practice-shell`），360/390px 不遮挡提交区；<720px 隐藏次要状态文字。
6. **Dev harness**（`routes/study.dev.unit.$unitId.tsx`，路由 `dev/unit/:unitId?examId=`，`VITE_DEV_TOOLS=1` 才启用，不进导航）：真实 Unit 走完整渲染管线；内置 dev-only 音频自动探针（真实 Audio 元素加载→seek→记录事件到 DOM）作为浏览器冒烟工具。
7. **root.tsx 挂载全局 QueryClientProvider**（冒烟发现的真实缺陷：此前只有测试壳提供 Provider，正式 app 直接崩溃）。

## 浏览器音频冒烟（用户要求的真实播放/拖动检查）

环境：隔离冒烟库 `nhg_manabi_v2_smoke`（alembic 全量迁移）+ 合成音频题 Unit 走完整发布门槛（stage→publish→human_reviewed→rights→promote）+ 真实 1s mp3 经 `python -m app.media_sync` 校验落盘 + uvicorn :8002（AUTH_MODE=dev_test）+ vite dev（/api 代理）+ **真实 headless Chrome**。

结果（证据：/tmp/smoke-dom*.html、/tmp/smoke5.png、uvicorn 访问日志）：

- Unit API 200；媒体经 `/api/releases/{rid}/assets/{aid}` **真实 Range 请求返回 206 Partial Content**（浏览器媒体管道行为）。
- 真实 Audio 元素 `loadedmetadata duration=1.00s`（完整文件可读），`seeking` 事件触发（拖动被接受）；播放器 dock 显示已加载时长 0:01，React 状态同步正常。
- 渲染管线截图确认：衬线阅读段落、cloze slot 高亮、题卡、选项、固定底部 dock 完整呈现。
- **未完成项（如实记录）**：headless 环境无输出设备且虚拟时间与实时媒体冲突，`seeked` 事件与出声播放未在 headless 内完成确认；最终「有声音、拖动顺滑」的人工确认需一次有头浏览器打开 `VITE_DEV_TOOLS=1 pnpm dev` 后访问 harness URL，或由 M2.3 E2E 覆盖。

## 冒烟抓到并修复的真实缺陷

- **root.tsx 缺 QueryClientProvider**：查询页在正式 app 直接崩溃（此前仅测试壳提供 Provider）——已修复。
- dev harness hook 顺序违规（早退后调 hook）——已修复。

## 实际执行的测试与结果

- `pnpm -F web typecheck`：**通过**。
- `pnpm -F web test`：**80 passed（13 文件）**（新增 29：RichText 矩阵 10——正常/空/未知节点/恶意属性/错误 format/深嵌套/重复 slot/越组 slot/白名单块；toViewModel 6；MaterialDisplay 6；AudioPlayer 7——渲染/播放暂停/时间显示/seek clamp/缓冲/失败/ play() 拒绝）。
- `pnpm -F web build`：**通过**（产物检查不变）。
- 浏览器冒烟如上（真实 Chrome + 真实服务端 + 真实文件），进程已清理。

## 测试边界说明

- happy-dom 媒体事件由测试手动派发（fireEvent，act 包裹）——**模拟 Audio 不等于真实音频可播放**，真实链路由上述浏览器冒烟与 M2.3 E2E 覆盖。
- 控制型 slider 的第二次 change 需先补 timeupdate（真实浏览器 seek 后必然触发）；React change 检测基于 value tracker。

## 未执行 / 留待后续

- 图片材料的真实图片服务（当前占位态；图片 asset 走同一媒体端点的渲染策略待定）。
- 有头浏览器人工「出声 + 拖动」最终确认（命令见 devlog，或 M2.3）。
- Ruby/list/table 的真实样本数据验证（当前五套样本未使用这些节点，仅合成用例覆盖）。
