# 2026-11-24 扩展练习独立导航项

## 范围与改动
- 顶部导航新增「扩展」（`/study/supplementary`），专项练习页移除「扩展练习」文字链接；扩展作答/结果页面包屑与高亮归「扩展」。
- ADR-0032；同步 P-002、`page-structure.md`、`AGENTS.md` 导航规则。纯前端。

## 测试
- web 全量 vitest：361 passed、1 failed（`SupplementaryPractice` 「starts a lesson…」，改动前即失败的既有问题）；`tsc --noEmit` 通过。
- 未做：浏览器视觉与窄屏五项宽度核对。

## 追加：反馈方式并排（同日）
- 扩展练习页「反馈方式」两个选项改为同一行并排（`topic-field-inline`），窄屏自动换行。
- 顺带修复既有失败测试：断言文案「结束后揭晓」与页面「结束后总结」不一致，改测试。web 全量 363 passed，tsc 通过；浏览器未核对。
- 修正：并排间距误用了不存在的 `--space-5` 令牌（间距失效），改为 `--space-4`。
