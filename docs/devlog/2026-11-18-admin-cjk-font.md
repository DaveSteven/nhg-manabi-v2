# 2026-11-18 管理端中文字体修复

- 范围：`apps/admin/src/styles/theme.css`。
- 原因：`--font-inter`/`--font-manrope` 写成 `'sans-serif'`（带引号，非通用族）且未加载 Web 字体，也无中文字体回退，中文显示效果差。
- 改动：新增 `--font-cjk-sans`（苹方/冬青/微软雅黑/Noto Sans CJK/思源黑体等）与系统西文栈，三套字体选项均追加中文回退，并补 `--font-sans`、`--font-system`。
- 测试：`tsc -b` 无输出（通过），`vite build` 成功。未做浏览器视觉复核。
- 风险：Linux 无中文字体的环境仍依赖系统字体。
