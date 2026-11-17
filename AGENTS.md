# AGENTS.md · nhg-manabi-v2

> **任务执行入口**。本仓库是 JLPT GO 2.0 的独立项目。开发前先读本文件及 `docs/README.md`，再按任务类型读相关规范。任何约束冲突不允许自行猜测并悄悄实施。

## 一、项目隔离与事实源

1. 本仓库根目录名 `nhg-manabi-v2`；旧项目 `nhg-manabi` 不属于当前工作区。不得修改、迁移、删除旧项目的代码、数据、账户或服务器。
2. 本项目设计采用 React + TypeScript、FastAPI、PostgreSQL 16、SQLAlchemy 2.0、Alembic，模块化单体架构。技术方案如需变更，先写 ADR。
3. **需求事实源优先级**：用户最新确认 → `docs/decisions/README.md` + 主题规范 → `docs/product/`、`docs/design/`、`docs/architecture/`、`docs/data/`、`docs/development/` → `docs/reference/prior-drafts/` → `docs/reference/v1/`。1.0 文档只用于参考，不能覆盖 v2 决策。
4. 文档标题中的“建议”“待验证”“待确认”绝不能当作产品已确认；如果缺少关键决策，先记录取舍与风险，避免擅自锁定。

## 二、产品不可违反的规则

- 顶部导航四项：首页、专项练习、历年试卷、我的学习；首页四学科直接入口，无全局侧边栏和大 Hero。
- 「樱与墨」现代克制视觉、页面级下划线 Tab；不可直接复制 v1 实心按压 Tab 和大范围衬线字体。
- Exam → Section → Layer → Unit → Question → Option；独立 Question 也建 Unit；Layer 不是共享材料组。
- 专项随机一次选**一个题型**、数量，智能随机默认新题为主并兼顾 20–30% 复习 Unit。
- 选择是草稿，**正式提交才计分**；即时反馈按 Unit，统一反馈按 Session；严格模拟交卷前 API 不能泄漏答案。
- 可带未答题提交，skip != wrong；历史所有答错保留，最近有效结果只看有实际选择的正式答案。
- 当前采用普通练习最多一个活跃 Session，须自动保存/恢复；关闭页面不等于主动结束。
- 严格模拟的时间/音频规则未经验证不应上线；旧结果永久追溯具体 release。

## 三、数据/发布权限红线

- **发布策略（2026-11-16 起，ADR-0010）**：用户决定默认 `PUBLISH_POLICY=auto`——入库即发布，暂不做审核流程；下面关于审核/发布门槛与 `rights_confirmed` 的几条仅在 `PUBLISH_POLICY=gated` 时适用（代码与测试保留）。`auto` 不得把内容标成已验证；部署、推送、合并 `main` 仍须用户明确授权。
- **Canonical v2.0 是业务内容交换标准**；上游 JSON/ID 和旧库字段不得流入新版业务条件。来源映射留在内部 provenance。
- Raw 输入只读；导入先进入 staging；Agent 提供校验建议但不能直接写 published 表。
- 内容审核采用轻量化流程：本地 Agent 校验优先（结果绑定内容哈希同步），异常人工复核。发布门槛接受 `agent_verified`（有有效哈希绑定校验证据）或 `human_reviewed`；`needs_review`、`blocked`、未校验、争议内容一律不得通过发布检查。
- 已发布 Release 不可被 Agent 直接修改；内容变更必须产生新的候选版本（新 content_hash → 新 release）。版权/使用许可是独立发布检查，发布前必须记录 `rights_confirmed` 决策。
- 内容已转换/结构验证通过 ≠ 答案正确 ≠ 获得合法对外使用权限。未审核题库不可直接公开。
- 已发布 Release 是不可变内容快照；新答案/解析修订产生新 release，历史 Session Unit 仍引用旧版。
- 学生端不能获取未授权正确答案、解析、来源私有文件或其他用户的作答数据。

## 四、每次开发的基本流程

1. 明确本次范围、涉及模块和依赖；阅读相应 `docs` 并列出任何不一致之处。
2. 检查 `git status`、目标环境、现有本地未提交变更；不覆盖他人工作，不擅自从外部拉覆盖代码。
3. 先写或更新精简测试用例和验收标准，再实现最小闭环；不因“顺便优化”扩散范围。
4. 若变更 Schema，写新的 Alembic revision 并验证真实 PG 升级/约束/回滚；不得在运行时私自补表。
5. 对 API/React/导入分别运行相关静态检查、测试和样本验收；报告未执行的检查，不宣称通过。
6. 如改变需求/架构，更新 `docs/decisions/` 及对应文档；完成时交代变更清单、测试结果、剩余风险。

### 分支与上线流程

1. `develop` 是日常开发与集成分支。实现、修复、测试和开发文档提交默认落在 `develop`；开始任务先确认当前分支，不在 `main` 上直接开发。
2. `main` 只代表已经成功上线的状态。普通开发任务完成、测试通过或准备上线，都不等于可以合并 `main`。
3. 上线使用经过审核和验证的 `develop` 提交。只有上线成功、验收完成并得到用户明确确认后，才把对应 `develop` 状态合并到 `main`。
4. 上线失败、回滚或仍待验收时，不得合并 `main`。继续在 `develop` 修复并重新验证。
5. 合并、推送、部署都属于独立外部动作；没有用户明确授权时不得自动执行。完成 `develop → main` 合并后回到 `develop` 继续日常开发。
6. 紧急 hotfix 如需从 `main` 处理，必须由用户明确指定；上线成功后同样把 hotfix 同步回 `develop`，避免两条分支分叉。

## 五、每次任务结束的收尾要求

每次任务结束时必须完成以下五项，缺一不可：

1. **新增一份 Markdown 开发日志**：记录本次任务范围、改动内容与结论，存放于统一的日志目录（如 `docs/devlog/`），命名含日期。
2. **更新项目总体进度**：维护进度文档（如 `docs/devlog/progress.md` 或等价文件），反映当前工程真实状态，不得夸大。
3. **记录实际执行的测试及结果**：写明运行了哪些检查/测试、真实输出结果；未执行的检查也要如实列出，不得虚报通过。
4. **架构决策变化时新增 ADR**：如本次改变了需求或架构，在 `docs/decisions/` 新增对应 ADR 决策记录；无变化则不需要。
5. **开发日志与代码一起提交 Git**：开发日志、进度更新、ADR 与本次代码改动属于同一次提交，不单独遗留未提交。

## 六、按模块阅读

- 题库/ETL：`docs/architecture/canonical-schema-v2.0.md`、`docs/data/import-spec.md`、`docs/data/content-review-policy.md`。
- 作答：`docs/product/business-rules.md`、`docs/design/practice-interactions.md`、`docs/architecture/postgresql-schema-v0.2.md`。
- 前端：`docs/design/design-system.md`、`docs/design/frontend-spec.md`、`docs/design/page-structure.md`、`docs/design/responsive-design.md`。
- 接口/工程：`docs/architecture/system-architecture.md`、`docs/development/api-conventions.md`、`docs/development/testing-strategy.md`。
- 旧系统定位问题：`docs/reference/v1/`（只读背景）。

## 七、当前工程真实状态（2026-11-17）

- 已有 PostgreSQL 真实迁移记录、Canonical staging 导入与发布、媒体同步、React 学生端与独立管理端，不能再按“仅骨架”安排开发。
- 已实现历年试卷目录、单 Unit Quick Practice、作答判题与解析、听力播放器及原文面板、学生账户与用户中心、管理端登录及试卷上下架。具体测试与验收边界见 `docs/devlog/progress.md` 和对应日期日志。
- 普通 practice 会话已有自动保存/恢复、提交与结果基础；**专项练习首版已接通**（题型目录、服务端智能抽样、`/study/practice` 配置页、顶栏与首页入口、再练一组），真实浏览器验收与 `user_question_progress` 缓存未做。Quick Practice 使用独立名额，不替代专项会话。
- 下一阶段：专项练习验收与遗留项见 `docs/development/topic-practice-next.md`；之后完善错题、学习历史与统计。
- 历史记录中的本地入库、容器冒烟与测试通过不代表生产已上线、内容答案已验证或全部浏览器已验收。严格模考规则、生产部署硬化与部分浏览器验收仍待完成。
