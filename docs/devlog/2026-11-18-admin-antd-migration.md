# 管理端迁移到 Ant Design（2026-11-18）

## 范围
用户要求把管理端前端框架从 shadcn-admin 换成 `~/Code/antd-admin`（Ant Design），并迁移全部功能。分支 `develop`。后端、API 契约、部署配置未改。

## 做法与决定
- 原地替换 `apps/admin`（路径、`pnpm --filter admin`、Dockerfile/nginx 均不变），旧实现保留在 git 历史。见 [ADR-0028](../decisions/ADR-0028-admin-ui-antd.md)。
- `antd-admin` 只作布局/技术组合参考，**未拷贝代码**：它带 MSW Mock、模拟权限菜单与自有 `/api/auth/*`，与本项目身份模型（ADR-0009）不符；也无 LICENSE。未采用其 Vite+（`vp`）工具链，沿用仓库现有 Vite + Vitest。
- 保留：`lib/api.ts`（axios + zod 严格 DTO）、`auth-store`（sessionStorage 令牌）、`safe-redirect`、`filter.ts`、`format.ts` 等纯逻辑与其测试，服务端校验的路由守卫。
- 重写界面：`components/authenticated-layout`（可折叠侧栏/移动抽屉、面包屑、深浅色切换、用户菜单+退出确认）、登录页、Dashboard、试卷管理、用户列表/详情、404/500。图表仍用 recharts。
- 删除 shadcn/Radix/Tailwind/React Hook Form/TanStack Table/sonner 等依赖与 `components/ui`，新增 `antd`、`@ant-design/icons`。通知改用 antd `message`，确认框改用 `Modal`。
- 列表交互调整：试卷表加 20 条分页；用户列表改用 antd 服务端分页（原“上一页/下一页”）。功能与口径不变。

## 迁移的功能
登录/退出/守卫、Dashboard（指标、趋势、功能使用、漏斗、提醒、7/30 天）、试卷管理（搜索/级别/状态筛选、下架含原因、恢复上架、统计汇总）、用户管理（搜索防抖、四项筛选、排序与方向、分页、详情、禁用/启用含原因与审计）。

## 实际执行的检查
- `tsc -b`：通过；`eslint .`：通过。
- `vitest run --config vitest.unit.config.ts`：10 个文件 / 49 tests 通过（含新增 nav、theme-store 测试；登录/Dashboard/试卷/用户测试改写为 antd 交互）。
- `vite build`：通过（antd 分包 1.16MB / 368KB gzip，已调高 chunk 警告阈值）。
- 真实浏览器（dev server :5175）：登录页渲染、未登录守卫重定向正常；用页面内伪造 XHR 数据对首页/试卷/用户三页的布局、侧栏切换、面包屑做了目检，控制台无错误（修掉了 antd `List` 弃用告警）。

## 真实后端走查（补充）
创建临时管理员 `qa-walkthrough`（凭据在 gitignored `.local/qa-admin.txt`，走查后已 `deactivate`），对开发库实测：
- 登录（含 `redirect` 回跳）、退出守卫；首页 Dashboard、试卷管理（105 套）、用户列表与详情均显示真实数据。
- 试卷下架（带原因）→ 恢复上架：列表与汇总即时刷新，最终回到 105/105 已发布。
- 用户禁用 → 启用（测试学生账号「走查小明」）：状态、按钮、审计记录正确，已恢复为正常。
- 深色模式、375px 移动端布局与抽屉导航正常。
- 发现：本机 8001 的后端进程是旧版本，缺少 dashboard/users 接口（404），需重启；走查时另起 8002 实例验证后已关闭。
- 修掉 antd 弃用告警：`Alert.message→title`、`Space.direction→orientation`、`List` 已移除。

## 仍未执行 / 风险
- Firefox/Safari 未测；用户详情页下方图表/表格区域未逐项目检。
- 未重建 Docker 镜像验证 `web.Dockerfile` 的管理端构建（命令与锁文件已更新，本地 `vite build` 通过）。
- 移除了上游 vitest 浏览器模式套件；e2e 未建立。
- antd 包体较大，仅管理端加载。
