# ADR-0030：扩展练习（V1 教材题）作为独立内容类型

- 状态：部分已确认（2026-11-19）。用户已确认：内容为自己编写或有授权；**独立入口、不混入专项练习抽样**。展示名「扩展练习」为建议名，待用户最终确认；内部类别名 `supplementary`。
- 日期：2026-11-19
- 关联：ADR-0010（auto 发布）、ADR-0016（单一进行中 Session）、ADR-0029（V1 用户迁移）

## 背景

V1 有 362 课、3618 道教材题（`books`/`questions`/`options`）：级别 N5–N1，科目 文法/漢字/語彙，每课 10 题，全部是单题 4 选 1，没有解析。V1 学员在这批题上有 448 条作答和 58 条错题记录，v2 目前没有对应内容。这批题不是历年真题，没有年月。

## 决定

1. **复用 Canonical → staging → Release 流程**，不另建题库表。每一「课」是一个 Canonical 包：一个 Exam（`kind = supplementary`）、一个 Section（科目）、按 v2 现有题型分的若干 Layer、每题一个 `single` Unit。这样不可变 Release、作答提交、`user_question_progress`、练习历史直接可用。
2. **`exam_catalogs.year/month` 仅对 `past_exam`/`mock_exam` 必填**（迁移 `0020`，新增 CHECK）；`supplementary` 的年月为 NULL。校验器的 `EXAM_KINDS` 增加 `supplementary` 并相应放宽 year/month。
3. **独立入口、不混入**：
   - 「历年试卷」目录与详情不显示 `supplementary`（目录接口按 `kind IN ('past_exam','mock_exam')` 过滤）。
   - 专项练习的抽样（含智能随机、只复习最近仍错）只使用 `past_exam`/`mock_exam` 的题；扩展题不进入其候选池。
   - 严格模考只作用于有 Phase 的卷；扩展练习没有 Phase，不开放模考。
   - 扩展练习有自己的目录接口与入口：级别 → 科目 → 第 N 课。入口放在「专项练习」页内，不增加顶部导航项。
4. **题型归类**：漢字按题干 `【】` 内是汉字（→ `vocabulary_kanji_reading`）还是假名（→ `vocabulary_orthography`）区分；語彙 → `vocabulary_context`；文法 → `grammar_form`。无法确定的标 `needs_review`，不得自动过发布门槛。
5. **转换不静默修正**：选项写在题干里的語彙题，从题干解析选项，解析失败的标 `needs_review`；选项数不是 4 个、正确答案不唯一的标 `needs_review`/`blocked` 并进转换报告。V1 无解析，不伪造解析。
6. **ID 与来源**：Canonical ID 形如 `JLPTGO-SUP-N3-vocabulary-L013`，V1 题号只进内部 provenance，不进业务条件。
7. **用户数据**：扩展题发布后，V1 教材作答与错题用 V1 题号 → provenance → v2 题号映射，写入 `user_question_progress`（沿用 ADR-0029 之后的迁移方案）。教材题的学习记录不进入「专项」统计。

## 学生端入口（2026-11-19）

- 路由 `/study/supplementary`（入口为专项练习页的文字链接，不增加顶栏项）；接口 `GET /api/supplementary/lessons`、`POST /api/supplementary/sessions`（见 api-conventions）。一课 = 该课全部可练习 Unit，按固定顺序创建普通 `practice` 会话，复用作答、反馈、结果。
- 与「我的学习」隔离：概览覆盖率、题目记录、练习历史、完成会话数均排除扩展练习（`kind` 过滤 + `config.supplementary`）；课程状态仅在扩展练习页展示。管理端 Dashboard 的功能分类暂把它归入「其他」。

## V1 教材作答迁移（2026-11-19）

- `user_question_progress` 是由正式答案**派生的缓存**（每次提交都从 `study_submitted_answers` 重算），只导缓存会在用户下次练习时被覆盖。因此 V1 教材作答导入为**已完成的 practice 会话 + 不可变正式答案**（V1 每个 attempt 一个会话，一道题一个 Unit），再由正式答案重建进度缓存。
- 会话 `config.supplementary` 带 `imported_from="v1"` 与 `v1_attempt_id`（幂等键），因此与其他扩展练习一样不进入「我的学习」；它们会计入管理端的正式作答/学习活跃统计（同一批用户在 V1 的真实学习）。
- 映射：V1 用户 → `users.legacy_v1_user_id`；V1 题 → `source_mappings`（`jlptgo-v1-book`）→ 当前已发布 Release 的 v2 题。对错按 v2 答案 Key 的**选项位置**重新判定；V1 快照答案与 v2 Key 不一致、被人工修订过的题（选项顺序变了）、选项缺失、Unit 不可练习的作答跳过并计数报告，不猜测。
- 脚本 `python -m app.v1_answer_import`，默认 dry-run；前置：v2 已导入对应用户（ADR-0029）和扩展课（本 ADR）。V1 `wrong_questions` 是聚合冗余，不单独导入。

## V1 真题专项作答迁移（2026-11-19）

- 同样导入为已完成 practice 会话 + 正式答案（`python -m app.v1_answer_import --kind exam --raw-dir <原始 exam.json 目录>`，默认 dry-run）。映射链：V1 题 `identity_json` →（原始 `exam.json` 中同一题的 `identity` 与上游 `objectId`）→ `source_mappings(mojitest)` → v2 题；选项按 `source_order + 1` 对应 v2 位置，对错按 v2 答案 Key 重判，快照答案与 v2 Key 不一致则跳过。
- V1 按「题」作答、v2 会话按「Unit」，且 V1 专项分类不对应 v2 题型，因此：同一 attempt 内同一 Unit 的答案共用一个 session unit；**只写入用户真正作答的题**（不为组题里没做的小题伪造“未答”）；会话标记 `config.imported = {source: "v1_practice", attempt_id}`，**计入覆盖率、仍错、抽样与管理端作答统计，但不列入「练习历史」与「完成练习数」**（避免无法展示的残缺记录）。如需展示历史，另行设计。
- V1 `exam_wrong_questions` 是聚合冗余，不单独导入；dry-run 时与导入后的仍错集合核对。

## 分期

- **本次（阶段一）**：ADR、迁移 `0020`、校验器与发布器放宽、历年试卷与专项抽样的 `kind` 过滤、V1 教材题转换器，并用一课样例验证导入。
- **阶段二**：学生端「扩展练习」入口与页面、全量转换与校验报告、人工复核异常题、用户作答迁移。

## 影响与风险

- `exam_catalogs` 被历年试卷目录、专项抽样、管理端试卷列表、学习历史共用；所有面向「真题」的查询必须按 `kind` 过滤，新增测试覆盖。学习历史按 Session 所属卷显示标题，不过滤。
- 管理端「试卷管理」也会列出扩展课；本次先按 `kind` 过滤出去，管理扩展课的界面留待阶段二。
- 3618 题没有解析、答案未经核对；默认 `PUBLISH_POLICY=auto` 会直接发布，必须在转换报告里把异常题标出，并在批量发布前由用户确认。

## 阶段一结果（2026-11-19）

- 迁移 `0020_supplementary_exams`、校验器/目录/专项抽样/管理端试卷列表过滤、转换器 `app/v1_book_convert.py` 已实现并有测试。
- 对线上 V1（只读）全量试转换：362 课 → 362 个包，**3617/3618 题转换**，全部通过结构校验（0 error）。1 题（第 19 课，题号 1758）因「正确答案 = 2」被排除；20 题标 `needs_review`（`options_unparsed` 12、选项数 3 个 7、选项数 5 个 1），分布在 11 课，学生端不可见，待人工复核。
- 其中一课（`JLPTGO-SUP-N1-grammar-L001`）导入真实 PG 测试库并自动发布：目录 `kind=supplementary`、年月为空，不出现在历年试卷列表，答案不在公开大纲里；测试后已清理。**未导入开发库和生产。**
- 补充：内联选项解析后，待复核降为 8 题（7 题为 3 选项题、1 题 V1 数据错位），另 1 题排除；见 devlog 补充。
- 补充二（2026-11-19）：用户确认 7 题 3 选项题放行、#2326 与 #1758 按推荐修复（转换器 `MANUAL_FIXES`/`APPROVED_THREE_OPTIONS`）；全量试转换 3618/3618 题、0 排除、0 待复核，全部通过校验。
