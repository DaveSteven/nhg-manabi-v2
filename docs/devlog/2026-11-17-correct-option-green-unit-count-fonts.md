# 2026-11-17 答对选项变绿 / 已练习次数高亮 / 中文字体

## 范围
前端三处体验优化（无后端、无 Schema 改动）。

## 改动
1. 提交后若该题 `is_correct === true`，所选选项行加 `option-correct`（绿边+浅绿底，覆盖选中粉色）；答错/未答不变。数据来自 feedback 载荷，未提交前不会出现（不泄漏答案）。
2. 试卷目录 Unit 行 `unit-meta`：「已练习 **N** 次」，N 用主色加粗（`.unit-count`），去掉「· N 题」；未练习仍为「未练习」。
3. 字体：`--font-sans` 原先把 Noto Sans JP / Hiragino Kaku Gothic ProN / Yu Gothic 放在系统中文字体之前，汉字落到日文字形。改为简体中文优先（PingFang SC、Hiragino Sans GB、微软雅黑、Noto Sans SC、思源黑体 SC）；新增 `--font-sans-ja`，日文题干与选项加 `lang="ja"`，`:lang(ja)` 使用日文字形优先。

## 实际测试结果
- `pnpm typecheck` 通过；`pnpm test` 见提交时输出：230 passed；`pnpm build` 通过。
- 测试更新：答对选项 `option-correct`、`.unit-count` 高亮、unit 行不再含题数。

## 未执行
- 浏览器目视（字体在 Windows/Linux 上的实际回退未测）；Docker 镜像是否已重建见对话。
