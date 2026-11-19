# 2026-11-19 · 扩展练习学生端入口

## 范围
ADR-0030 阶段二的第一步：学生端「扩展练习」入口与按课练习闭环（独立入口、不混入专项抽样）。不含：批量导入内容、V1 作答迁移、管理端扩展课管理。

## 改动
- 后端 `app/api/supplementary.py`：`GET /api/supplementary/lessons`（按等级、科目分组的课程，题数只计可练习题，附本人最近有效结果统计）、`POST /api/supplementary/sessions`（以该课全部可练习 Unit 创建普通 practice 会话，`config.supplementary`，沿用单名额替换）。
- 隔离：`/api/me/learning/*`（概览、题目记录、练习历史、完成会话数）排除扩展练习。
- 学生端：`/study/supplementary` 页面（科目 Tab、反馈方式、整卡片开始的课程网格、课程状态）、`PracticeSession.config.supplementary` DTO、作答页/统一反馈页/结果页的标题、面包屑与返回按钮识别扩展练习；专项练习页加入口链接；样式 `.lesson-grid/.lesson-card`。
- 文档：page-structure、api-conventions、ADR-0030。

## 测试
- 后端 `pytest -q`（真实本地 PG 测试库）：320 passed, 2 skipped（新增 `test_supplementary_api.py` 6 项：登录要求、课程目录只计可练习题与等级过滤、进度统计、开始一课与单名额替换、非扩展课/未知课 404、与我的学习统计和历史隔离；去掉过滤后隔离测试会失败，已做变异验证）。
- 学生端 `vitest run`：42 文件 360 passed（新增页面测试 8 项）；`tsc --noEmit`、`npm run build` 通过。
- 真实浏览器走查（本地 vite + 本地 API 连测试库，导入 6 个合成课）：课程列表、开始一课、作答提交与即时反馈、返回后课程状态变为「已做 1/10」、我的学习练习历史为空。测试库数据已清理。

## 未执行 / 风险
- 真实 3618 题尚未导入开发库/生产，页面目前只验证了合成课；未做移动端与其他浏览器验收。
- 结果页沿用普通结果页的对错列表（无解析，因为 V1 无解析）；扩展课的「再练一课」「错题复习」未做。
- 页面标题沿用学习区统一标题；管理端 Dashboard 把扩展练习会话归入「其他」。
- V1 教材作答/错题尚未迁入。
