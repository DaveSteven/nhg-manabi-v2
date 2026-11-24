# 2026-11-24 试卷详情：文字词汇/文法点開「問題N」练习整个大题

## 范围
用户要求：历年试卷详情页的文字词汇、文法两科，不再一题一题（Unit）进入，点「問題N」直接练习该大题全部题目。

## 改动
- `ExamOutline.tsx`：vocabulary/grammar 科目的 LayerBlock 变为直达按钮，点击用现有 `POST /api/practice/sessions` 创建一个包含该 Layer 全部 Unit 的普通练习（即时反馈）；读解/听力保持展开逐 Unit Quick Practice。
- `sessions.ts` / `useStartPractice.ts`：新增 `createLayerSession`、`useLayerPracticeStart`。
- 无后端、Schema 变更。普通练习沿用 ADR-0016 单名额，会替换进行中的普通/专项练习，不占 Quick 名额。
- 更新 `docs/design/page-structure.md`；无新 ADR（页面级交互决定，已记入规范）。

## 测试
- `vitest run app/features/catalog`：28 passed（ExamOutline 改写并新增 vocabulary/grammar 直达、读解展开、错误提示用例）。
- `tsc --noEmit`：无输出（通过）。
- 全量 web vitest：360 passed、1 failed——`SupplementaryPractice` 「starts a lesson…」在未改动代码（git stash）下同样失败，属既有问题，未处理。
- 未做：后端测试（未改后端）、真实浏览器验收。

## 风险
- 大题完成后的结果页/返回路径沿用普通练习，未单独验证。
- 点击整条胶囊即开始并替换进行中的普通练习，无确认（与 ADR-0016 一致）。

## 追加：入口提示优化（同日）
- 直达的大题胶囊去掉 ▸（展开暗示），右侧改为与单题行一致的 › ；meta 显示「共 N 题 · 已练习 X/Y」（N 为该大题全部题数）。读解/听力仍为 ▸ 展开。
- 测试：catalog 28 passed，tsc 通过；web 容器已重建；未做浏览器视觉核对。
- 未做：误触确认（需改 ADR-0016 的「无冲突弹窗」，待用户决定）、结果页回到该大题。

## 追加：胶囊显示题型名（同日）
- 试卷详情接口 layer 新增 `question_type_label`（`question_types.label_zh` 左连接，无 Schema 变更）；文字词汇/文法胶囊显示「問題1 汉字读音 · 共 5 题 · 已练习 X/Y」。
- 测试：backend `-k "outline or content or catalog"` 16 passed（真实 PG）；catalog web 28 passed；tsc 通过。api/web 容器已重建；浏览器未核对。

## 追加：学科 Tab 记忆（同日）
- 试卷详情的学科 Tab 选择按「科目」存入 sessionStorage（每份试卷一条，另记最近使用科目，新试卷沿用）；从练习返回、刷新、重进都停在原科目。仅当前浏览器标签页有效，无后端改动。
- 测试：catalog 29 passed（新增重进恢复用例）；tsc 通过；浏览器未核对。大题展开状态未做缓存。

## 追加：读解/听力大题也显示题型名（同日）
- 展开型大题胶囊（读解、听力）与直达型一致，显示「問題13 内容理解（短篇）」；数据沿用 `question_type_label`，无后端改动。catalog 29 passed，tsc 通过；web 容器已重建，浏览器未核对。
- 观察：用户截图中顶栏五项在窄视口下被截断（「扩展」「学习」露出不全），尚未处理。
