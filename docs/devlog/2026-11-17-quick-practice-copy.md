# Devlog · Quick Practice 文案按试卷结构动态化 + 按钮样式补齐

日期：2026-11-17 · 分支：develop · quick-practice.md v2.1

## 任务范围

按用户 2026-11-17 指示：Quick Practice 文案按 Canonical Unit 的题目数量与材料类型
动态调整（不出现 Unit/Session 等技术概念）；多题 Unit 内部「上一题/下一题」分页；
追加指示：Layer 头部简化为「已练习X/Y」数字高亮；检查所有按钮样式；改完提交并重建 Docker。

## 改动内容

### 文案映射（新文件 `quickPracticeCopy.ts`）

按真实数据分布（开发库 9,225 个已发布 Unit：single 4,965 全部单题 / audio 3,145 以单题为主 /
passage 962 / cloze+comparison 153 全部多题）：

| Unit 类型 | 提交按钮 | 下一组文案 |
|---|---|---|
| 独立单题（single、单题听力） | 提交答案 | 下一题 |
| 文法多题组（cloze/comparison 等 question_count>1） | 提交本组 | 下一组 |
| 阅读文章（passage，含单题文章） | 提交本篇 | 下一篇 |

- 标题：quick 会话用大纲推导的真实位置（`問題1-3`，与目录行同源，`outlineUnitLabel`），
  不再显示「练习 · 组 N」；单 Unit 不显示「第 1/1 组」；提交后不显示「已提交锁定」
  （专项练习模式保留原有标题与锁定标记，行为不变）。
- 多题分页：quick 多题 Unit 一次显示一题，「上一题/下一题」（首末禁用），材料保持可见；
  分页纯展示层，整组提交事务不变（submitCalls 断言仍为一次全量 answers）。
- 下一组定位不变：同卷按 Layer/Unit position，最后一个 Unit 不显示下一组按钮。

### Layer 头部简化（ExamOutline）

「已练习 X / Y 组 · N 题」→「已练习X/Y」（如 `已练习3/5`），数字 `.layer-progress`
主色（--color-primary）高亮加粗，「已练习」保持 muted。

### 按钮样式补齐

排查结果（grep 全部无 className 的 button 并逐个核对作用域样式）：

- `.practice-actions / .dialog-actions / .practice-post-submit-nav` 中非 `.primary` 按钮
  （返回试卷、重新练习本组、继续答题、采用服务器值、取消等）此前是浏览器默认灰样式 →
  新增描边胶囊次级样式（hover 主色描边）。
- `.practice-post-submit-nav` 容器此前完全无样式 → 补 flex 布局。
- 听力原文面板加载失败的「重试」按钮无样式 → 新增 `.transcript-retry` 描边胶囊
  （与 `.audio-retry` 风格一致但中性色）。
- 核对已覆盖无需改动：页面 Tab（`.tabs [role="tab"]`）、unit 行/layer 头（capsule-card）、
  分页按钮（本任务新增 `.question-pager`）、原文 Cue（`.transcript-cue`）、
  跟随/中文对照 Switch（`.follow-switch`）、头像选择（`.avatar-pick`）、
  AudioDock 主控制、Select combobox。`ActiveSessionConflictDialog` 为未挂接的既有组件未动。

### 其他

- 幂等提交提示「本组已提交…」→「已提交…」（去「本组」）。
- `question-pager` / `layer-progress` 样式入 `_practice.scss` / `_catalog.scss`。

## 实际执行的测试与结果

- `PracticePage.test.tsx` quick 块重写为 6 个用例：真实标题問題1-3 + 无第1/1组 + 零草稿请求、
  提交答案→下一题开新会话（POST 体=同卷下一 Unit）+ 无锁定标记、多题分页（首末禁用、
  整组一次提交且 answers 完整）+ 下一组、未答一次确认、已完成回显无草稿、
  最后一组无下一题按钮；专项练习 4 个既有用例不变全过。
- `ExamOutline.test.tsx`：Layer 断言改为「已练习1/1」「已练习0/1」，进入练习页标题断言
  改为「問題1-1」。
- 全量前端 **230 passed**；`tsc --noEmit` 通过；`pnpm build`（含产物/凭据检查）通过。
- 开发过程中自查修正两处实现问题：quickCopy 引用未声明变量的顺序错误（TDZ）、
  标题断言与新文案不一致。
- 后端无改动，未重跑（上一轮 179 passed + 2 skipped 仍有效）。

## 未执行 / 待验证

- 真实浏览器视觉走查（含新分页器与次级按钮观感）交由用户 :8080 实测；Firefox/Safari、
  深色模式未测。
- passage 类「提交本篇/下一篇」仅由文案映射单测覆盖映射规则本身，未在真实读解 Unit 上
  走浏览器端到端。
