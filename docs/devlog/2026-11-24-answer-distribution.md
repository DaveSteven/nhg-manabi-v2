# 2026-11-24 历年答案分布

## 范围
用户要求：按 N5–N1 等级筛选、按题型筛选、也可看全部，展示历年试卷正确答案各选项的占比。

## 改动
- 后端：`GET /api/answer-distribution`（`app/api/answer_distribution.py`，需登录）按（等级、题型、选项位置）汇总当前已发布历年/模拟试卷的答案键；返回题型字典（按试卷顺序）；排除 needs_review/blocked；无 Schema 变更。
- 前端：`/study/answer-distribution` 页（等级 tabs、题型分组 Select、横条分布、各题型对照表可下钻）；专项练习页加入口；面包屑与顶栏归「专项」。
- 文档：`page-structure.md` 新增页面规范；未新增 ADR（不改变架构，口径与边界写入规范）。

## 测试
- 后端 `test_answer_distribution.py` 2 passed（真实 PG：需登录、汇总与答案键一致、不含题目级字段）。
- 前端 `answerDistribution` 4 passed，tsc 通过。api/web 容器已重建；浏览器未核对；全量前端 367 passed、后端 331 passed + 2 skipped。

## 风险
- 口径是「当前发布版本的答案键」，PUBLISH_POLICY=auto 下答案未全部人工验证，页面已声明。
- 听力 3 选项（即时应答）等题型选项数不同，横条按实际最大位置显示；对照表固定列 1–4。
