# 2026-11-19 · 扩展练习（V1 教材题）阶段一

## 范围
ADR-0030：把 V1 教材题作为独立内容类型「扩展练习」（`supplementary`）迁入 v2 的 Canonical/Release 流程；用户确认「独立入口、不混入专项抽样」，内容为自己编写或有授权。本次只做后端与转换，不做学生端入口、不批量导入、不迁用户作答。

## 改动
- 迁移 `0020_supplementary_exams`：`exam_catalogs.year/month` 可空，新增 CHECK 保证 `past_exam/mock_exam` 必填；downgrade 在存在无年月行时拒绝。
- 校验器：`supplementary` 为新 kind，且不得带 year/month；`past_exam/mock_exam` 新增 year 必填校验。
- 隔离：历年试卷目录 `GET /api/exams`、专项抽样候选/错题/历史、管理端试卷列表均按 `kind IN ('past_exam','mock_exam')` 过滤。
- `app/v1_book_convert.py`：V1 book → Canonical 包（一课一包、单题 Unit、按题型分 Layer）；语彙题把写在题干里的选项解析为真正选项；无法安全转换的排除或标 `needs_review`，不静默修正；V1 题号只写入内部 provenance。
- 文档：ADR-0030、决策表 P-030、`canonical-schema-v2.0.md` 的 kind/year/month。

## 全量试转换（只读 V1 线上，输出到临时目录，已删除）
- 362 课 → 362 包，3617/3618 题转换；全部包通过 `validate_package`（0 error，20 条 conversion 警告）。
- 排除 1 题（第 19 课，正确答案 = 2）；`needs_review` 20 题（选项无法从题干解析 12、选项数 3 个 7、5 个 1）。

## 测试
- 后端 `pytest -q`（真实本地 PG 测试库）：307 passed, 2 skipped（新增 `test_supplementary.py` 8 项：题干选项拆分、题型归类、转换报告、包通过校验、validator 日期规则、发布后年月为空与 CHECK、目录与专项抽样隔离且去掉过滤后确实会出现）。
- 测试库 `alembic downgrade 0019_username_login` → `upgrade head` 通过。
- 真实 PG 测试库中导入并自动发布一课（`JLPTGO-SUP-N1-grammar-L001`），经 API 核对：不在历年试卷列表、大纲可访问且无答案；已清理。

## 未执行 / 风险
- 学生端「扩展练习」入口与页面、管理端扩展课管理、全量导入、V1 教材作答/错题迁移均未做；未导入开发库与生产。
- 3618 题答案未核对且无解析；按 `PUBLISH_POLICY=auto` 批量导入即发布，建议先处理 20 题 `needs_review`、确认 1 题排除，再批量导入。
- 学习历史等接口对 `year/month` 为空的卷未做前端适配（学生端入口未开放前不会出现）。
- 未做浏览器验收。

## 补充：待复核题处理（同日）
- 转换器新增「题干内联选项」解析（`1.A2.B3.C4.D`、漏点号、跨行混写，必须恰好 4 个非空选项才接受），V1 的 `[漢](かん)` 注音保留为可见文字 `漢(かん)`。已有 4 项参数化测试、不猜测测试、真实题形转换测试；后端 `pytest -q` 313 passed, 2 skipped。
- 对线上 V1 重新试转换：`needs_review` 由 20 题降到 **8 题**（12 题 `options_unparsed` 全部自动解决，答案位置人工逐题核对一致）；剩余为 7 题本来就是 3 个选项（内容读起来正确）、1 题（#2326）V1 数据错位；另 1 题（#1758）因重复选项且双正确答案仍被排除。后两题需用户决定修法，未擅自改内容。

## 补充二：用户决定与人工修订（同日）
- 用户确认：7 题本来就是 3 选项（#405、#419、#632、#781、#794、#2689、#2812）放行，#781 的「×」选项保留；#2326、#1758 按推荐修。
- `v1_book_convert.py` 新增 `MANUAL_FIXES`（按 V1 题号、附理由，且只在 V1 行与预期完全一致时才生效，否则报告 `manual_fix_stale` 并排除，不盲改）与 `APPROVED_THREE_OPTIONS`（仅放行已核对的 3 选项题，其他选项数异常仍标 `needs_review`）。修订理由写入内部 provenance 的 `manual_fix`。
  - #2326：题干还原为「会社まで車で10分の（　　　）だ。」，选项取真实 4 项，正确答案由 V1 误标的「長所」改为「距離」。
  - #1758：去掉重复选项「出そう」，保留 3 项，正确答案「出そう」。
- 对线上 V1（只读）重新试转换：362 包、**3618/3618 题全部转换**，排除 0、待复核 0、隐藏 Unit 0，全部通过结构校验（0 error、0 warning）。后端 `pytest -q`：314 passed, 2 skipped。
- 仍然成立：答案未经核对（`review_status=unverified`）、无解析；批量导入、学生端入口、用户作答迁移未做，未导入开发库与生产。
