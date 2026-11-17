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

## 追加修复：option-correct 被 :has() 覆盖
`.option-row:has(input[type=radio]:checked)` 特异性 (0,3,1) 高于 `.option-row.option-correct` (0,2,0)，绿色被选中粉色覆盖（DevTools 中被划线）。新增 `.option-row.option-correct:has(input[type=radio]:checked)` 提升至 (0,4,1)。构建产物已确认含该规则，web 镜像已重建；未跑浏览器目视。

## 追加：去掉提交成功横幅
提交成功后不再渲染 `<p role="status">已提交：答 N 题，未答 M 题</p>`（含幂等「已提交（重复请求…）」与 alreadySubmitted 的确认文案），结果由反馈卡片展示。提交**失败**文案保留。typecheck 通过，vitest 230 passed；web 镜像已重建。

## 追加修复：下一题提交报 question_not_in_unit
**现象**：专项/快速练习提交 u04 后点「下一题」进入 u05（新会话，同一 PracticePage 实例），再提交时请求体带上了 u04-q01 与 u05-q01，服务端 422 `question_not_in_unit`。
**根因**：`useDraftManager` 的 reducer 状态随组件实例存活，跨会话导航不重置；`manager.answers()` 收集了全部历史题目。
**修复**：新增 `answersForUnit(all, questionIds)`（`draftMachine.ts`），提交时只发送当前 Unit 的题目；后端校验保持不变（正确地拒绝了脏数据）。
**测试**：新增 draftMachine 单测；前端 231 passed，typecheck 通过；`pnpm test` 的 ECONNREFUSED 日志在改动前即存在，不影响通过。web 镜像已重建。浏览器端到端（连续两题）待用户确认。
