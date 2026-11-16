# 开发日志 · 2026-11-16 · Claude 强制入口

## 范围

在仓库根目录新增 `CLAUDE.md`，确保 Claude Code 进入项目后无需依赖 skill 的隐式匹配，就会先加载仓库规则和项目开发 skill。

## 改动

- 使用 `@AGENTS.md` 导入仓库级指令，并再次明确要求完整读取 `AGENTS.md`。
- 所有规划、评审、调试、测试和代码变更在行动前加载 `.claude/skills/nhg-manabi-development/SKILL.md`。
- 固定读取文档导航、有效决策和最新 progress，再由 skill 按任务类型补读规范。
- 要求先核实工作树与实际实现，不把计划、旧摘要或未提交代码当作完成状态。
- 保留 JLPT GO 1.0 隔离以及内容审核、答案权限、身份、Release、测试和收尾红线。

## 验证

- `git diff --check`：通过。
- 人工检查 `CLAUDE.md` 引用的 `AGENTS.md`、skill 和三份必读文档路径均存在。
- 对照 Anthropic Claude Code 官方 memory 文档，确认项目根目录 `CLAUDE.md` 会自动加载，且 `@path/to/import` 是受支持的文件导入语法。
- 未运行 pytest 或前端构建：本次只新增 Claude 项目入口和文档记录，不修改产品代码。

## 决策

无产品或架构变化，不新增 ADR。
