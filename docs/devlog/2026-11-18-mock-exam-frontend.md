# 2026-11-18 · 严格模拟考试：说明页与考试页（前端）

## 范围
按用户的 UI 方案先做统一框架（顶部状态栏 + 答题卡 Drawer），再接入现有题型布局；含说明页、交卷确认、最小成绩页。不含严格听力播放器、成绩页逐题回顾。设计与边界写入 `docs/design/mock-exam-ui.md`。

## 改动
- **后端小补充**：`GET /api/mock-exams/{id}/content`（当前阶段全部 Unit 的无答案内容，附所属大题 layer 标签/科目，一次请求）。
- **API 层**：`api/dto/mock.ts`、`api/endpoints/mock.ts`；`useDraftManager` 新增可选 `save`（模考用独立草稿接口）；`SharedMaterialLayout` 新增可选 `focusRequest`（答题卡跳转可激活对应 Slot/题）。
- **`features/mock/`**：`MockIntro`（真实 Phase/时限/题量与规则、开始/继续/显式放弃重来）、`MockExam` + `ExamPhaseBody`（状态栏、一屏多题、文章填空/读解沿用双栏 Sticky、大题导航、阶段交卷确认）、`AnswerSheetDrawer`（覆盖式、按真实大题分组可折叠、已答/当前/标记、Esc/遮罩/×/跳转关闭）、`ExamTopBar`、`ExamSubmitDialog`、`MockResults`（最小）、`MockBanner`（学习布局下「模拟考试进行中 · 剩余时间」，ADR-0020 待办）、`useServerCountdown`（以 `server_now` 校准，到 0 重读服务器状态）。
- 路由：`/study/exams/:examId/mock`、`/mock/:sessionId`（study 布局外）、`/study/mock/:sessionId/results`；试卷详情页「模拟考试」入口仅在可模考时显示；`deploy/nginx.conf` 增加 `/mock` 的 SPA 回退（否则直接打开/刷新为 404，真实浏览器发现）。
- 样式：`_exam.scss`。

## 测试（实际执行）
- 后端全量：**253 passed、2 skipped**（`/content` 断言并入模考测试：仅当前阶段、带大题标签、无答案字段）。
- 前端 `vitest`：34 文件 / **289 passed**（新增 `MockExam.test.tsx` 11 项：访客跳登录；状态栏真实数据与服务器时钟；草稿恢复计入进度；选择走模考草稿接口；答题卡分组/折叠/状态/标记/跳转关闭；Esc；交卷确认→提交全部答案；保存失败明确提示；完成跳成绩页；说明页真实阶段与合计、不可用说明、继续/显式替换；`mockModel` 3 项）；`tsc --noEmit` 无输出；`npm run build` 含产物检查通过。测试进程仍有既知的 happy-dom 卸载 fetch `ECONNREFUSED` stderr 噪声，退出码正常。
- **真实环境**（Docker 栈重建，开发库迁移到 0014，用本机测试账号，内置浏览器窗格隐藏故用 JS 读取页面）：真实库 105 套中 45 套可模考、60 套因 `units_not_ready` 不开放；对 N2 2012-12 走通：说明页（105+50=155 分钟、106 题）→开始→考试页（14 个大题、75 题、1:45:00）→选择保存→答题卡 14 组（当前展开）→跳到文章填空/长篇读解（双栏、面板题号）→刷新恢复（所在大题、已答 1/75、时钟继续）→DB 把阶段 1 提前到过期→刷新后自动封存并进入「聴解」阶段（时钟 ≈48 分）→交卷→成绩页（各阶段/科目，未答 105、答错 1）。

## 未执行 / 风险
- **视觉/响应式未亲眼核对**（窗格视口 0×0）：状态栏换行、抽屉宽度、窄屏布局、Sticky 避让、深色模式、Firefox/Safari 均未看。
- 严格听力播放器未做：听力阶段只显示题目与提示、不播放音频；音频可用性尚未作为开放条件。成绩页无逐题回顾/解析。
- 「标记」与所在大题仅存本机 localStorage。
- 本次真实走查在本机开发库为测试账号留下一场已完成的模考记录（不进练习统计）。未推送、未部署。
