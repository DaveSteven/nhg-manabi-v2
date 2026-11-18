# 2026-11-18 专项练习：结果页与答案解析页合并

范围：仅专项练习（即时/统一反馈完成后、练习历史进入）。不碰模考、Quick Practice、后端。决策见 ADR-0026。

## 现状盘点与文档不一致
- 结果页 `routes/study.practice.$sessionId.results.tsx` 显示六项统计 + 「逐题复盘」列表 + 「查看答案与解析」跳回练习页；解析在 `PracticePage`/`UnifiedPractice` 完成态中就地展示。
- 文档（design-system §面包屑、button-spec 的「查看答案与解析」/「查看结果」、frontend-spec 统一反馈段）仍描述两页往返，已同步更新。
- 后端 `/results` 已含 chosen/correct option 与正误，`/feedback` 提供解析，门控未变，无需新接口。

## 改动
- 新增 `features/practice/TopicReview.tsx`：成绩概览（正确率取服务端 answered_accuracy，口径文案）、复用 `question-strip` 题号导航（✓/×/中性，默认首个错题）、`SharedMaterialLayout` 展示完整 Unit（同 Unit 切题不重载材料，Slot 联动）、所选/正确答案标注、解析、上一题/下一题、底部两个操作。
- 结果路由对专项会话渲染合并页；`PracticePage` 对已完成专项会话跳转到 `/results`；`UnifiedPractice` 去掉「查看结果」。
- `_practice.scss` 增加合并页样式；ADR-0026、文档同步。

## 测试（实际执行）
- 新增 `TopicReview.test.tsx`（10 例）；调整 `results.topic.test.tsx`、`UnifiedPractice.test.tsx`。
- `apps/web`：`vitest run` 38 文件 335 passed；`tsc --noEmit` 无错误；`react-router build` 成功。
- 后端未改动，未重跑。
- **未做**：真实浏览器验收（桌面/375px 视觉、听力 Unit 在合并页播放与原文）；未覆盖多 Unit 同题型图片/听力题的真实数据走查。

## 剩余风险
- 非专项会话仍用原结果页（含得分率），如需统一另行确认。
- 合并页每个 Unit 一次 feedback 请求（切 Unit 前已并发预取），题量大时请求数 = Unit 数。
