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
