# 2026-11-24 专项练习题型按试卷顺序排列

- 问题：`/api/topic-practice/types` 按 `subject, id` 字母序返回，文字词汇显示为 文脉规定、汉字读音、汉字书写…，与试卷 問題1→6 不一致。
- 改动：`topic_practice.py` 新增 `TYPE_PAPER_ORDER`（汉字读音→汉字书写→造语→文脉规定→近义替换→用法；文法 形式→重组→文章；读解/听力按常见出题顺序），列表按此排序，未登记题型排最后。前端沿用接口顺序，未改。无 Schema 变更。
- 测试：新增 `test_topic_type_order.py`（2 项）+ `test_topic_practice.py` 共 9 passed（真实 PG）。api 容器已重建；浏览器未核对。
- 风险：读解/听力顺序为按各级常见顺序的折中（各级真实大题顺序略有差异）；若需严格按级别，应改为取该级别试卷中的 Layer 位置。
