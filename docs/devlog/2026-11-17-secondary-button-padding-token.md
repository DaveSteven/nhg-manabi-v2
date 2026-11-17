# 2026-11-17 次级按钮内边距 token 修正

## 范围
修复 `.dialog-actions` / `.practice-post-submit-nav` 次级按钮（如「返回试卷」）内边距失效。

## 改动
- `apps/web/app/styles/_practice.scss`：`padding: 0 var(--space-5)` → `var(--space-4)`。
  `tokens.scss` 只定义 `--space-1/2/3/4/6/8`，`--space-5` 不存在，声明解析失败导致 padding 退回浏览器默认。
- 全仓扫描 `var(--space-N)`：仅使用已定义 token，无其他未定义引用。
- 用户截图中的旧样式属浏览器缓存/旧页面，需强制刷新。

## 实际执行的测试与结果
- `pnpm typecheck` 通过；`pnpm test` 230 passed；`pnpm build`（含产物检查）通过。
- 构建产物 CSS 中确认为 `padding:0 var(--space-4)`。
- `git diff --check` 无输出。

## 未执行
- 未再做浏览器截图复核（上一轮截图步骤因额度中断）；请强制刷新后目视确认。
- 后端无改动，未运行。
