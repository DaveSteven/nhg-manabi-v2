# 2026-11-24 扩展练习独立导航项

## 范围与改动
- 顶部导航新增「扩展」（`/study/supplementary`），专项练习页移除「扩展练习」文字链接；扩展作答/结果页面包屑与高亮归「扩展」。
- ADR-0032；同步 P-002、`page-structure.md`、`AGENTS.md` 导航规则。纯前端。

## 测试
- web 全量 vitest：361 passed、1 failed（`SupplementaryPractice` 「starts a lesson…」，改动前即失败的既有问题）；`tsc --noEmit` 通过。
- 未做：浏览器视觉与窄屏五项宽度核对。
