# nhg-manabi-v2 · 文档导航

> 此目录为 AI Agent 开发的**新版需求事实源**。旧版资料已完整备份到 `reference/v1/`，只做参考，不自动继承实现细节。

## 按任务阅读

| 任务 | 必读文档 |
|---|---|
| 启动任何任务 | 根目录 `AGENTS.md`、本页、`decisions/README.md` |
| 讨论或修改产品需求 | `product/prd.md`、`product/business-rules.md`、`product/feature-scope.md` |
| 用户端 UI | `design/design-system.md`、`design/button-spec.md`、`design/frontend-spec.md`、`design/page-structure.md`、`design/practice-interactions.md`、`design/responsive-design.md`、`design/select-spec.md`、`design/audio-player.md`、`design/quick-practice.md`、`design/mock-exam-ui.md` |
| 管理端 UI | `decisions/ADR-0008-shadcn-admin-foundation.md`、`development/admin-frontend-implementation.md`、`data/content-review-policy.md` |
| 题库转换 | `architecture/canonical-schema-v2.0.md`、`data/import-spec.md`、`data/agent-validation-contract.md` |
| 数据库/后端 | `architecture/postgresql-schema-v0.2.md`、`architecture/system-architecture.md`、`development/api-conventions.md` |
| 发布和审核 | `data/content-review-policy.md`、`architecture/validation-report.md` |
| 测试、部署 | `development/testing-strategy.md`、`development/deployment.md` |
| 检查 1.0 的旧行为 | `reference/v1/`，不得直接照搬 |

## 文档优先级（冲突时）

1. 用户本次对话中**最新明确确认**的决定；应及时写入 `decisions/` 并修订对应规范。
2. `decisions/README.md` 中当前有效决策 + 本目录最新版主题规范。
3. 当前 `product/`、`design/`、`architecture/`、`data/` 与 `development/` 正式文档（每份按主题分权威，不互相覆盖职责）。
4. `reference/prior-drafts/`：早期讨论或协议初稿；旧状态已被后续决定覆盖时不再生效。
5. `reference/v1/`：历史事实和可复用经验；不是 2.0 的规范。

**文档不是执行权限**：设计明确不等于授权生产数据变更、真实发布或 Git 推送。实现前核对工作区并由用户决定目标环境。

## 当前状态（2026-11-17）

- 已实现数据库迁移、Canonical 导入与发布、媒体读取、学生端学习流程、学生账户及管理端登录/试卷上下架；详见 [总体进度](devlog/progress.md)。
- 历年试卷单 Unit 快速练习已实现；普通练习的草稿、恢复、提交、反馈及结果能力可复用。
- **专项练习首版已接通（2026-11-17）**：题型目录、服务端智能抽样、配置页、顶栏/首页入口与「再练一组」；真实浏览器验收未做。
- **我的学习首版已实现（2026-11-17）**：`/study/learning` 学习概览/练习历史/题目记录（错题策略 B），见 `devlog/2026-11-17-learning-stats.md`；收藏、统计时间范围未做。
- 专项练习实施记录与遗留项：[topic-practice-next.md](development/topic-practice-next.md)。下一步补错题、学习历史及统计；严格模考先验证规则。
- 以上依据代码核查及已有开发日志，不代表本次重跑测试或确认生产状态。已发布内容不等于答案已验证，历史测试和未验收范围须按日期查阅。

## 规范维护约定

- 已确认 / 待确认 / 建议 / 待验证必须显式标识；不能以「之前提过」替代确认。
- 新决定写入 `decisions/`，同时更新受影响的产品、前端与业务文档。
- 不在早期草稿中直接删除历史，保留有助于理解设计演变的差异。
