# 前端（学生端 + 管理端）

两个前端均为 React 19 SPA，但工具链、状态管理、样式方案完全不同。通信契约与部署见 `architecture.md`。

---

## 学生端 nhg-manabi-web（5173）

### 技术栈

React 19 + react-router-dom 7（BrowserRouter）+ **TanStack Query v5**（服务端状态）+ **Zustand 5**（客户端会话状态，部分 persist）+ Vite 7 + TypeScript（`strict: false`）+ Sass + lucide-react + DOMPurify + Vitest + Testing Library（jsdom）。底层 fetch 封装仍为 `src/lib/study.ts` 的 `api()`，无 axios。

状态架构三规则与域索引见 `state-management.md`（T-022/T-023 重构后的权威文档）。

### src/ 结构

| 目录/文件 | 职责 |
|---|---|
| `src/main.tsx` | `QueryClientProvider`（默认 `retry: 1`、`refetchOnWindowFocus: false`、staleTime 0）、季节 accent（`data-season`）、主题应用 |
| `src/App.tsx`（63 行） | **纯路由组合**（T-023 收敛），不持有业务状态；`/login` 独立页，业务路由统一包在 `RequireAuth` 门卫下 |
| `src/routes/` | `RequireAuth.tsx`（顶层门卫：auth 恢复、加载/错误态、挂载 `useQuizSessionRestore`）、`LoginRoute.tsx`、`AuthRoutes.tsx`（注册/邮箱验证/找回/重置密码）、`ExamRoutes.tsx`、`PracticeRoutes.tsx` |
| `src/stores/` | Zustand：`auth.ts`（persist key `auth-storage`，partialize 只存 token，含旧键 `japanese-study-session-token` 一次性迁移）、`examSession.ts`（模考会话 + 保存状态）、`quizSession.ts`（quiz/专项练习会话，事实源在服务端 practice_sessions）、`listening.ts`（persist，播放进度按 userId 分桶 + 听力练习会话）、`preferences.ts`（level/subject/practiceMode/dailyGoal/pendingPractice/error；UI 偏好 setter 写穿 localStorage，键名不变） |
| `src/pages/` | 页面组件，按业务域拆文件：`index.tsx`（首页/搜索/错题本/用户/答题）、`ExamPages.tsx`（模拟考试视图）、`PracticePages.tsx`（专项练习配置）、`PracticeResult.tsx`、`StatsPages.tsx`（统计）、`Listening.tsx`（听力专项）；混有同域 `.test.tsx`（jsdom 环境） |
| `src/components/` | `CommonUi.tsx`（Progress/PageHeader/OptionButton/ModalOverlay/DailyRing/ThemeToggle 等通用件）、`ExamParts.tsx`（答题卡/听力播放器/考试回顾）、`ResultParts.tsx`（结果页骨架）、`FavoriteButton.tsx`（星形收藏，textbook/exam 两 source）、`Html.tsx`（DOMPurify 消毒渲染富文本）、`ListeningTrainer.tsx`、`HomeMotivationCards.tsx`、`QuestionPersonalBadge.tsx`、`UiSelect.tsx`、`Tooltip.tsx`、`ZoomImage.tsx`、`UserAvatar.tsx`/`AvatarPicker.tsx`/`EditProfile.tsx`（T-036 头像与资料编辑） |
| `src/hooks/` | actions 层：`useExamFlow.ts`（模考全生命周期：分节、保存队列串行化、重试、提交；Query 在此层）、`useQuizFlow.ts`（quiz/专项练习会话 actions + `useQuizSessionRestore`）；数据层：`useLibraryData.ts`（`useBooks`/`useExams`/`useStudyData`）、`useFavorites.ts`、`useStudyDerived.ts`（bookStats/错题合并/今日题数/继续学习建议等派生）；`useKeyboardAnswer.ts`（数字键 1-4 快捷键）、`useLevelChoice.ts` |
| `src/lib/` | 纯逻辑层：`study.ts`（`api()` 封装、snake_case→camelCase `map*` 映射、JLPT 算分 `calculateExamScore`/`examPassMark`、模考答案缓存）、`appHelpers.ts`（练习模式/每日目标）、`stats.ts`、`listening.ts`、`examDates.ts`（考试日期倒计时）、`questionStats.ts`、`avatars.ts`、`theme.ts`；各 lib 有对应 `.test.ts` |
| `src/styles/` | `index.scss` `@use` 聚合 19 个 partial（`_variables` 断点、按页面域拆分），类名直接写 JSX，无 CSS Modules |

### 路由（组合在 `App.tsx`，视图分属 `pages/` 与 `routes/`）

| 路径 | 页面 |
|---|---|
| `/` | 按登录态分流：已登录 → `/home`，未登录 → `/login`（根路径预留宣传页，D16） |
| `/login` | 独立登录页（不在 RequireAuth 下） |
| `/register`、`/verify-email`、`/forgot-password`、`/reset-password` | 注册 / 邮箱验证（幂等重放）/ 找回 / 重置密码（`AuthRoutes.tsx`，T-028） |
| `/home` | 题库首页（书架、继续学习建议、每日目标环、motivation 卡、考试倒计时） |
| `/search` | 跨书题目搜索 |
| `/quiz` | 书本/混合/错题重练/收藏答题（完成切 `ResultView`） |
| `/wrong` | 错题本（合并题库 + 真题两个来源） |
| `/favorites` | 试题收藏列表（合并教材/真题两源） |
| `/:category-practice`（grammar/vocabulary/reading） | 专项练习：配置→答题→结果三态 |
| `/practice-setup` | 基础练习确认页 |
| `/listening/:examId?/:questionId?` | 听力专项训练 |
| `/exams`、`/exams/:examId/start`、`/exams/:examId`、`/exams/:examId/review/:attemptId` | 模拟考试列表/说明/作答（分节计时）/回顾（`ExamRoutes.tsx`） |
| `/stats` | 学习统计（含 T-014 学习效率 panel） |
| `/user` | 用户资料与练习历史（T-034 左右布局改版） |
| `*` | 重定向 `/home` |

`/home` 及以上业务路由全部在 `<Route element={<RequireAuth />}>` 下。

### 状态管理（详见 `state-management.md`）

- 三条架构规则：①服务端是进行中会话的唯一事实源（模考 run / 专项练习 session）；②localStorage 只做可丢弃加速缓存与 UI 偏好（auth 只存 token，currentUser 走 `/api/me` 会话恢复）；③路由守卫只读统一状态层（store/Query 缓存），不读写 localStorage。
- 服务端状态：TanStack Query（main.tsx 全局默认 + 各域 useQuery/useMutation）；客户端会话：`src/stores/` Zustand。
- API 封装：`src/lib/study.ts` 的 `api(path, options, token)`——拼 `API_BASE`（`import.meta.env.VITE_API_BASE`，dev 默认 `http://127.0.0.1:8000`，prod 空串同源）、注入 Bearer、429 限流提示；**401 = token 失效清会话回登录页**（对齐管理端 `utils/http.ts`），登录接口的 401 透传后端 detail（T-031）。

### localStorage 键（T-022 后收敛）

| 键 | 内容 | 性质 |
|---|---|---|
| `auth-storage` | zustand persist，仅 token（旧键 `japanese-study-session-token` 已迁移退役） | 事实源在服务端，token 为凭证 |
| `japanese-study-exam-cache:<userId>:<examId>` | 模考答案草稿（与服务端 merge 恢复） | 可丢弃加速缓存 |
| `japanese-study-user-level` | 等级选择缓存（按 userId） | UI 偏好 |
| `japanese-study-keyboard-hint-seen` | 快捷键提示已读标记 | UI 偏好 |
| `manabi_practice_mode` / `manabi_daily_goal` / `manabi_exam_target` / `manabi_theme` | 练习模式 / 每日目标 / 目标考试日 / 主题（读写入口收拢在 `preferences.ts` / `appHelpers.ts`，键名不变） | UI 偏好 |

`manabi_quiz_session` 已在 T-022 刀二随服务端 `practice_sessions` 上线而退役。

### 关键契约

- snake_case ↔ camelCase 转换集中在 `study.ts` 的 `mapBook/mapAttempt/mapExam/...`；提交时转回 snake_case。
- `question_type` 数值分段（`examPartLabel`，`study.ts`）：`≥41` 听力 / `≥31` 阅读 / `≥21` 文法 / 其余文字与词汇。
- JLPT 算分与合格线在前端实现（`calculateExamScore`/`examPassMark`，`study.ts`）。
- 题干/解析富文本必须经 `Html.tsx` 的 `cleanHtml`（DOMPurify）渲染。
- 收藏：`FavoriteButton` 星形组件（独立文件，ids 未加载静默隐藏）接入教材答题/真题回顾/听力等场景；基础练习单题卷沿用 `readPracticeMode()` 直进 `/quiz`，不弹 `/practice-setup`。

### 命令

```bash
npm run dev / typecheck / test   # vitest 单文件：npm test -- src/lib/stats.test.ts
```

### 未确认

- 仍无 `vite.config.*`：dev 代理、路径别名均不存在；`@vitejs/plugin-react` 在 dependencies 但无配置文件挂载是否生效待核实。jsdom 测试环境靠测试文件头 `// @vitest-environment jsdom` 注释启用（已确认）。

---

## 管理端 nhg-manabi-admin（5180）

### 技术栈与工具链

React 19 + Ant Design 6 + TanStack Router（文件式，`routeTree.gen.ts` 为插件生成勿手改）+ TanStack Query v5 + Zustand（persist）+ Zod v4（import 路径为 `zod/v4`）+ react-quill-new + recharts + DOMPurify + lucide-react，TypeScript strict（`@/*` 别名）。工具链为 **Vite+ (`vp`)**，包管理 pnpm 但**禁止直接调 pnpm/npm**：

```bash
vp install && vp dev      # 5180
vp check --no-fmt         # 改动的统一验证命令
vp test                   # vitest（当前仓库内暂无测试文件）
```

测试工具从 `vite-plus/test` 导入；详见 `AGENTS.md`。

### src/ 结构

| 目录/文件 | 职责 |
|---|---|
| `src/api/` | `schemas.ts`（全部 Zod schema，字段保持后端 snake_case 不改名）、`auth.ts`/`user.ts`/`examQuestion.ts`/`stats.ts`（端点常量 + fetch 函数，**必须** `Schema.parse()` 解析，禁止绕过） |
| `src/utils/` | `http.ts`（fetch 封装：`ApiError`/`HttpError`、自动解包 `json.data`、401 清 `auth-storage` 跳 `/login`）、`session.ts`（会话恢复 + 权限派生）、`appMenu.ts`（菜单树 + 路径→权限映射）、`constants.ts`（`API_BASE_URL`）、`datetime.ts`（时间戳按 UTC 解析后本地展示） |
| `src/stores/` | `auth.ts`（persist key `auth-storage`，仅持久化 token + isAuthenticated，不持久化 user/menus）、`settings.ts`（darkMode 跟随系统、sidebarCollapsed）、`createPersistentStore.ts` 工厂 |
| `src/routes/` | TanStack 文件式路由；`_auth.tsx` 布局守卫（beforeLoad 检查登录 + `canAccessPath`）；路由私有组件用 `-` 前缀文件 |
| `src/components/` | 目录式组件：`DataTable/`（AntD Table flex 包装 + Skeleton/Empty）、`FilterToolbar/`（溢出筛选项收进 Popover）、`FormModal/`、`Auth/`（权限包裹）、`Layout/`（MainLayout/Sidebar/Header/UserMenu 子目录）、`Aurora/`（登录背景）、`Icon/`、`NotFound/` |
| `src/hooks/` | `useResourceCRUD.ts`（通用列表 + CRUD mutation 封装）、`tokenBuilders.ts`/`useAppTheme.ts`（明暗主题）、`usePermission.ts` |

### 路由清单（实际定义在 `src/routes/`，清单见生成的 `routeTree.gen.ts`）

| 路由 | 页面 |
|---|---|
| `/login` | 登录（`POST /api/admin/auth/login` → `/api/admin/me`；注意 README.md 已过时，以 `src/api/auth.ts` 为准） |
| `/dashboard` | 全局汇总 + 注册/活跃趋势（`/api/admin/stats/summary`） |
| `/exam-questions` | 真题校正·试卷列表（卡片网格 + 答案/解析进度条，`order=todo` 按未完成度排序） |
| `/exam-questions/$examId` | 真题校正·整卷修订页（核心，见下） |
| `/users`、`/users/$userId` | 学员管理 CRUD；详情页含统计总览/活动热力图/趋势图（私有组件 `-UserActivityHeatmap`/`-UserTrendChart`/`-UserBreakdownCharts`/`-FormModal`/`-Toolbar`） |
| `/403`、`/404`、`/`（重定向 `/login`） | — |

search params 用 Zod 校验（`validateSearch` + `.catch()` 容错），URL 为状态源（如 `$examId?questionId=` 可深链）。

### 真题校正工作流（`src/routes/_auth/exam-questions/`）

三层结构：
1. **试卷列表** `index.tsx`：试卷卡片 + 校正进度。
2. **整卷修订** `$examId.tsx`：一次拉全卷（page_size 300），按学生端展示规则分组（大分类→問題n 题组→小题），题目列表渲染在 `-PaperQuestionList.tsx`；`WorkbenchState { layerId, drafts, baselines }` 整组播种草稿，dirty 用 JSON 比较；保存为逐题串行 PATCH、只提交有变化的小题、逐题容错；成功后 invalidate `["exam-questions"]` 并重播种。
3. **题组工作台** `-LayerWorkbench.tsx`：所有小题常驻可编辑——正确选项、`answer_status`/`analysis_status`、译文与解析（Quill 富文本）、题目原文（Quill 富文本，T-032）、审核备注、结构化解析文档、版本历史 Timeline（对应后端 `exam_question_revisions`）。

端点（`src/api/examQuestion.ts`）：`GET /api/admin/exams`、`GET /api/admin/exam-questions`、`GET /api/admin/exam-layers/{layerId}/questions`、`GET|PATCH /api/admin/exam-questions/{id}`。

复核口径：答案完成 = `answer_status ∈ {auto_verified, verified, corrected}`；解析完成 = `reviewed`；任一 `disputed` 即存疑。

### 管理端约定

- **API 响应用 Zod 校验**，保留后端 snake_case 契约；queryKey 按域命名（`["exam-questions", "paper", id]` 等）。
- **保持 AntD 默认配色**（不覆盖 colorPrimary 等品牌色，仅定制圆角/字体/阴影）；样式优先级：组件原生 API → `theme.useToken()` + inline style → CSS。页面用 `token.*` 而非硬编码色值。
- 题目 HTML 渲染同样过 DOMPurify（`cleanHtml`/`cleanInlineHtml`，与学生端同 profile）。
- 按改动类型遵循 `.github/instructions/`（frontend / api / refactor 三份 scoped 规范）。

### 未确认

- `schemas.ts` 中 `AuthTokensSchema`（双 token）与 `PaginatedResponseSchema`（list/total）疑为模板遗留，真实后端为单 token / `items` 分页，是否可删未确认。
- `/users` 页为模板演示起点，后端 `/api/admin/users` 完整可用，页面覆盖度未逐一核对（T-031 已补 email/状态展示与停用恢复）。
