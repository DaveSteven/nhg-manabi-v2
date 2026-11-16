# 开发日志 · 2026-11-16 · Claude 项目开发 Skill

## 范围

为 `nhg-manabi-v2` 新增项目级 Claude skill，使后续实现、修复、评审、测试和开发规划任务自动遵循“先读事实源、检查工作树、按模块补充阅读、真实验证、更新日志与 progress、同批提交”的流程。

## 改动

- 新增 `.claude/skills/nhg-manabi-development/SKILL.md`。
- Skill 将 `AGENTS.md`、文档导航、有效决策和 progress 作为每次开发的必读入口，并按前端、作答、API、数据库、Canonical/ETL、发布、M2、部署路由到对应规范。
- 不复制易过期的工程完成状态；要求每次从 `docs/devlog/progress.md`、Git 历史和实际代码重新核实。
- 固化项目隔离、公开答案权限、Schema 迁移、测试真实性、开发日志、进度更新、ADR 和提交边界。
- 明确纯调查/评审任务在未要求修改时不应为了满足收尾流程而产生文件或提交。

## 验证

- 使用 skill validator 检查 frontmatter、命名和未完成占位符。
- 执行 `git diff --check`。
- 未运行后端 pytest 或前端构建：本次只新增 Claude Markdown 指令，不修改产品代码；`apps/web` 仍未建立前端工程。

## 决策与风险

- 无产品或架构变化，不新增 ADR。
- Skill 通过项目级自动发现降低重复提醒，但 Claude 是否选择隐式加载仍取决于客户端的 skill 发现机制；`AGENTS.md` 继续保留为仓库级强制入口和最终事实源。
