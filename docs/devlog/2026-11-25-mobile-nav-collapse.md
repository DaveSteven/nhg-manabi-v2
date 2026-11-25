# 2026-11-25 移动端导航折叠

## 范围
窄屏（<768px）顶部导航由「整行胶囊」改为折叠：品牌 | 登录/用户控件 | 菜单按钮同一行，点击按钮展开下拉面板。无决策变更（P-002 五项不变；响应式规范「窄屏可采用紧凑替代导航，核心入口一键可达」范围内），未新增 ADR。

## 改动
- `apps/web/app/components/TopNav.tsx`：新增 `topnav-wrap` 与切换按钮（`aria-expanded`/`aria-controls`）；路由切换、Esc、点击外部自动收起。
- `apps/web/app/styles/global.scss`：≥768px 外观不变（wrapper `display: contents`，按钮隐藏）；<768px 为 44px 圆形按钮 + 右对齐下拉面板，导航项 44px 触控高度。
- `TopNav.test.tsx`：新增展开/Esc 收起、选择后收起 2 条用例。

## 测试
- web `vitest run`：44 files / 379 tests 通过；`tsc --noEmit` 通过；`git diff --check` 通过。
- 浏览器（Vite dev，390px 与桌面宽度）走查：收起、展开、桌面不变均符合预期。

## 未做 / 风险
- 360px、真机 Safari、深色/200% 字号未验收；模考、练习页自身顶栏拥挤问题未涉及；未部署。

## 补充：模考顶栏窄屏整理
- `ExamTopBar` 把「字号 / 答题卡」包进 `.exam-bar-actions`（宽屏 `display: contents`，布局不变）。
- ≤600px：隐藏品牌图标，改为三行紧凑网格——「试卷名 | 倒计时」、小号当前位置、「已答进度 | 字号 + 答题卡」，约 120px（原先 4 行约 200px），保存失败提示独占第四行。
- 练习页自身的标题行（题号 + 字号设置按钮）在窄屏已是单行，未改动。
- 验证：临时 dev 路由（已删除）在 390px / 360px / 1200px 下渲染 `ExamTopBar` 目视检查；web 379 tests、tsc 通过。
- 未验：真实模考会话（含保存失败提示、长试卷名、听力 Mini Player 叠加）、真机。试卷名在 360px 下较长时会省略。

## 补充二：试卷列表、听力 Dock、统一登录拦截（用户同日追加）
- **试卷列表（<600px）**：年份独占一行，下方是月份胶囊（保持两列对齐），胶囊内边距缩小。
- **听力 Dock**：核查发现窄屏无任何适配——单行需约 535px（信息+控制+进度+倍速+音量+原文），358px 宽时进度条被挤没。<600px 改为两行：整宽进度条在上，控制与倍速/音量/原文在下，隐藏信息块，`--audio-dock-height` 调为 108px（页面底部留白随之变大）。真实媒体上点播放，`currentTime` 正常推进（2.4s/2.5s）。
- **统一登录拦截（ADR-0036 / P-034）**：此前**没有**统一拦截，只有学习页/账户页/模考页各自 `Navigate`，目录页对游客照常展示。现在 `StudyLayout` 统一守卫，401 全局处理会清会话，登录后回到原页面（站内 `/study` 路径白名单）。**这是对游客可浏览的行为变更。**
- 测试：web 385 tests、tsc 通过（新增守卫 3、登录回跳 2、401 钩子 1，既有 TopNav/目录测试改为先登录）。浏览器：guest 访问 `/study/exams` → `/login` 已验证；试卷列表、听力 Dock 在窄屏渲染已看（模拟 358px）。
- 未验：真实账号登录回跳全流程、会话过期时练习中途被踢回登录（未保存的草稿由现有重试机制处理，未专门验证）、真机、模考页听力 Mini Player 窄屏。浏览器验证用了本地伪造 profile 与 fetch 桩，未使用任何真实凭证。

## 补充三：试卷目录对游客开放
- 用户反馈：目录可以看，点击再登录。守卫改为白名单 `/study` 与 `/study/exams`，其余 `/study/*` 仍跳登录（ADR-0036 已修订）。
- 测试：web 386 tests、tsc 通过；浏览器（dev 代理到本地后端）游客打开 `/study/exams` 显示 105 个试卷胶囊，点击进入 `/login`。
- 游客在目录页看到的是全部等级（无等级选择器），属已有行为。

## 补充四：降低登录门槛、首页「今天来一组」
- 试卷详情（`/study/exams/:id`）对游客开放只读：显示提示「登录后可开始练习…」，不请求练习状态与模考记录；点任一大题/Unit → `/login`，登录页显示「登录后继续：<试卷名>」，登录后回到该详情页。
- 首页新增「今天来一组」卡：登录、有等级、且没有可继续的练习时，取该等级「从未作答 Unit 最多」的题型（优先非 provisional），默认 10 组、即时反馈、smart 抽样，一键开始（沿用 `/api/topic-practice/sessions`，数据全来自 `/topic-practice/types` 真实计数）；有进行中练习时只显示「继续上次练习」。
- 测试：web 391 tests、tsc 通过（新增：详情游客跳转、登录页意图提示、守卫放行详情/拦截 mock、今天来一组 2 条）。浏览器：游客详情页 → 点問題1 → `/login` 并显示「登录后继续：2025年12月 N2」已验证。
- 未验：「今天来一组」真实账号下的显示与开始（仅测试覆盖）、等级为空的用户首页无此卡（不引导选等级，待做）、登录后回跳全流程、注册路径不携带意图、真机。

## 补充五：无等级用户首页引导
- 已登录但没有备考等级、且无进行中练习时，首页显示「先选一个备考等级」卡（N5–N1 按钮）；选择走原 `useLevel.setLevel`（本地即时生效并同步 `PATCH /api/me`），随后「今天来一组」卡自动出现。
- 测试：web 392 tests、tsc 通过（新增 1 条：选等级后出现今天来一组）。**未做浏览器真实账号验证**；游客不显示此卡。

## 补充六：登录守卫改为声明式路由
- 新增 `components/RequireAuth` + `routes/_require-auth.tsx`；`routes.ts` 把需登录的路由嵌套在它下面（`layout(..., {id})` 用了两次：`/study` 内与布局外的严格模考 `/mock/:sessionId`），公开段只有首页/目录/详情。`study.tsx` 里的路径白名单与守卫删除；LearningPage/AccountPage/MockIntro/MockExam/MockResults 的零散 `Navigate` 改为 `return null`（守卫已保证登录）。
- 顺带修复：严格模考页之前不在 `/study` 布局内，仅靠页面自带跳转；现在统一受守卫保护，也避免成绩页在游客状态先发请求。
- 测试：web 391 tests（45 files）、tsc、`pnpm build`（含 check-build）通过；新增 `RequireAuth.test.tsx`（公开/拦截/回跳/401）；旧的各页「游客跳登录」用例并入该测试。浏览器（dev 代理本地后端）：游客 `/study/learning`、`/study/practice`、`/mock/abc` → `/login`；`/study/exams` 与详情不跳。
- 未验：真实账号下各受保护页正常进入（仅测试覆盖）。

## 补充七：移动端点击默认高亮
- `html { -webkit-tap-highlight-color: transparent }` 去掉浏览器默认蓝/灰点按闪色；交互元素加 `touch-action: manipulation`（去双击缩放延迟）。
- 原来只有 `.btn` 有 `:active` 反馈，卡片/胶囊/选项行去掉默认高亮后会没有任何按压反馈，所以补了 `(hover: none)` 下的轻量按压态（浅底色 + 缩 1.5%，reduced-motion 下不缩放）：试卷胶囊、capsule-card、科目卡、题型卡、Unit/大题行、选项行、顶栏链接。
- 验证：web 391 tests、tsc、build 通过；**未在真机/真实触屏验证**（桌面浏览器无法触发 `hover: none`）。
