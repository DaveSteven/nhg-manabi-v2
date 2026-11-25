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
