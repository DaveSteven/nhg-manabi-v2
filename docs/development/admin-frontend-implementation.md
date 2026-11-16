# JLPT GO 2.0 · 管理端前端实施计划

**状态：** Planned，技术基线已由 ADR-0008 确认  
**应用：** `apps/admin`  
**上游：** `https://github.com/satnaing/shadcn-admin`  
**边界：** 独立 SPA；不属于当前 M2.2 学生端交付

## 1. 目标

基于 `shadcn-admin` 建立 JLPT GO 2.0 内部管理端，优先完成：

1. 导入批次与结构校验结果。
2. 数据质量 Issue、阻断原因与处理状态。
3. Unit/Question 审核及原始/Canonical/Release 对照。
4. 内容哈希绑定的审核证据与发布门槛。
5. Release 发布决策、版本历史和旧版追溯。

管理端保持上游默认主题与视觉，不复用学生端「樱与墨」配色。业务正确性、权限和可追溯性优先于装饰性 Dashboard。

## 2. 引入方式

- 实施时选择并记录一个明确的上游 commit/tag，禁止直接依赖不断变化的 `main`。
- 先在隔离临时目录检查许可证、依赖、安装/构建脚本、环境变量、网络请求、示例认证和 Mock，再选择性迁入 `apps/admin`。
- 不复制上游 `.git`、Netlify 配置、示例密钥、Clerk 配置、演示账号或无关业务页面。
- 在 `apps/admin/THIRD_PARTY.md` 或等价文件记录来源、固定版本、MIT 许可证位置、本地删除/修改内容和后续升级方法。
- 保留必要的 MIT 许可证与版权声明。

## 3. 工程基线

计划沿用上游的 React + TypeScript + Vite、shadcn/ui、Tailwind、Radix、TanStack Router/Query/Table、Zustand、React Hook Form 与 Zod。实际引入时：

- 锁定依赖版本和包管理器，不自动升级到未验证的新版本。
- 使用独立 API adapter 和运行时 DTO 校验对接 FastAPI。
- TanStack Query 管理服务端列表、详情、Mutation 和失效；Zustand 仅保存真正的客户端 UI 状态，不复制服务端审核/发布状态。
- URL 保存筛选、分页、排序和可分享的审核定位；敏感数据不进入 URL 或持久化 Store。
- 管理端独立构建产物和 SPA fallback，不影响 `apps/web` 的 SSG+SPA 配置。

## 4. 身份与权限

- 移除上游 Clerk 集成；正式身份接入由 JLPT GO FastAPI 认证方案决定。
- 前端 Route Guard 不是安全边界。每个管理 API 由后端校验管理员身份和权限。
- 至少区分查看、审核/Issue 处理、发布决策等能力；具体角色在认证里程碑确认。
- `dev_test` 或 Mock 认证只能用于隔离开发环境，生产构建默认禁用。
- 不将内部 token、答案、审核证据、Raw 路径或私有媒体打进静态资源。

## 5. 页面与实施顺序

### Phase A · 安全引入与壳层

- 固定上游版本、许可证与供应链检查。
- 建立独立构建、路由、错误边界、登录占位和 API adapter。
- 删除演示页面/数据，保留必要的布局、组件和可访问性能力。
- 保持上游默认 light/dark 主题；不做「樱与墨」重绘。

### Phase B · 导入与数据质量

- Import Job 列表/详情、结构统计、diagnostic 和失败回滚信息。
- `content_issues` 列表、blocking/open/resolved 筛选和证据详情。
- N4 cue 越界等真实问题可定位到 Unit、asset 与时间范围。

### Phase C · 审核工作台

- Unit/Question 审核队列。
- Raw/Canonical/Release 对照、RichText/媒体预览和答案复核。
- Issue 创建/解决、脏值提示、未保存离开确认和事件时间线。
- 审核结论必须绑定当前内容哈希；旧哈希结果清晰标记失效。

### Phase D · 发布与版本

- 发布门槛预检：审核状态、open blocking、媒体、权利确认。
- 发布决策二次确认和后端权限校验。
- Release 历史、当前指针、内容哈希和历史 Session 引用查看。
- 不允许 Agent 或普通审核身份直接绕过发布检查。

## 6. 测试与验收

- 单元/组件：DTO、权限状态、筛选 URL、表格、长文本、对话框、脏值和错误状态。
- 集成：TanStack Query 缓存失效、401/403/404/409/422 映射、Mutation 失败回滚。
- E2E：导入批次 → Issue → Unit 审核 → 发布预检 → 授权发布/拒绝。
- 安全：未授权身份无法读取 Draft/答案/证据或触发发布；静态构建无凭据。
- 视觉：桌面主工作流优先，同时验证 1024px 和窄屏可查看；保留上游原始主题，重点检查信息密度、日文换行和键盘焦点。
- 构建：类型检查、lint、单元测试、生产构建和关键 Playwright 流程全部记录真实结果。

## 7. 非范围与依赖

- 本计划不替代 M2.2 学生端开发，也不要求两个前端共享组件库、Router 或主题。
- 未完成正式管理员认证和管理 API 前，可先使用 MSW/隔离测试接口搭壳层，但不得把 Mock 描述成真实后端已完成。
- 不复制 JLPT GO 1.0 管理台；只参考其批量编辑、修订时间线和对照体验。
- 未经用户明确授权，不克隆上游、安装依赖、发布、部署或推送。

## 8. 首个实施任务完成标准

1. 上游版本和许可证记录完成。
2. `apps/admin` 可独立安装、类型检查、测试和构建。
3. 无 Clerk、示例密钥或无关业务页面残留。
4. FastAPI adapter、认证占位和一条“Import Job 列表 → 详情”纵向流程可运行。
5. 新增开发日志、更新 progress，并在 `develop` 同批提交；不上线、不合并 `main`。
