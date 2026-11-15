# 数据库结构总览

来源：`nhg-manabi-api/app/models.py`（全部表定义的唯一位置）。PostgreSQL 16，SQLAlchemy ORM，启动时 `ensure_schema` 负责增量建表/补列。

通用约定：

- 主键：业务实体表多为自增 `Integer`；用户/管理员表用 UUID `String(36)`。
- 布尔用 `Integer` 0/1 表示（如 `is_correct`），无独立 BOOLEAN 列。
- 时间为 `DateTime`（UTC）；`created_at` 多为行创建时间。
- 做题相关的时间/时长字段为后续迁移新增（T-011 / T-014），**存量行 NULL = 未采集**，只从上线时刻起算。
- 学生端（`users`）与管理端（`admin_users`）账号体系完全隔离，token 互不通用。

## 表分组

| 分组 | 表 |
|---|---|
| 账号与会话 | `users`、`auth_email_tokens`、`user_sessions`、`admin_users`、`admin_user_sessions` |
| 教材题库 | `books`、`questions`、`options` |
| 教材做题记录 | `attempts`、`attempt_answers`、`wrong_questions` |
| 真题库 | `exams`、`exam_layers`、`exam_questions`、`exam_options`、`exam_question_revisions` |
| 真题模考 | `exam_runs`、`exam_run_answers`、`exam_attempts`、`exam_attempt_answers`、`exam_wrong_questions` |
| 专项练习 | `practice_sessions`、`practice_attempts`、`practice_attempt_answers` |
| 收藏 | `favorites` |

---

## 账号与会话

### users — 学员账号

学生端账号（D12 拆表后此表只剩学员）。UUID 主键对外隐藏自增序号。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | String(36) PK | 否 | UUID，所有引用列为 String(36) |
| username | String(64) | 否 | 登录名，全表唯一 |
| display_name | String(128) | 否 | 展示名 |
| password_hash | String(255) | 否 | 密码哈希，默认空串 |
| current_level | String(16) | 否 | 当前级别，默认 N5 |
| created_at | DateTime | 否 | 注册时间 |
| last_active_at | DateTime | 是 | 冗余活跃时间戳，登录/提交做题时更新，供后台排序与活跃统计 |
| email | String(255) | 是 | T-028 自助注册，全表唯一，仅验证/找回用；B4 代建账号为空 |
| activated_at | DateTime | 是 | 激活时间；NULL = 未验证不可登录 |
| disabled_at | DateTime | 是 | T-031 停用时间；NULL = 正常。停用 = 保留数据 + 禁止登录 + 删除会话 |
| avatar | String(32) | 是 | T-036/D30 头像 ID，12 款官方图案文件名白名单；NULL 回退显示名首字印章 |

### auth_email_tokens — 邮箱验证/密码重置令牌

T-028。验证与重置共用一张表，`purpose` 区分。token 只存 SHA-256 哈希；一次性 = 校验通过后删行。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| user_id | String(36) FK users | 否 | |
| token_hash | String(64) | 否 | SHA-256，唯一索引 |
| purpose | String(16) | 否 | `verify` / `reset` |
| expires_at | DateTime | 否 | 过期时间 |
| created_at | DateTime | 否 | |

### user_sessions — 学员会话

学习端登录会话（`scope = "app"`）。管理员会话在 `admin_user_sessions`，互不通用。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| user_id | String(36) FK users | 否 | |
| token | String(128) | 否 | 会话 token，唯一索引 |
| scope | String(16) | 否 | 默认 `app`（学习端） |
| expires_at | DateTime | 否 | |
| created_at | DateTime | 否 | |

### admin_users — 后台管理员账号

D12。与学员表结构隔离，无学习语义字段。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | String(36) PK | 否 | UUID |
| username | String(64) | 否 | 唯一 |
| display_name | String(128) | 否 | |
| password_hash | String(255) | 否 | |
| created_at | DateTime | 否 | |

### admin_user_sessions — 管理员会话

镜像 `user_sessions`，token 存 SHA-256；无 scope 列（整表即 admin 语义）。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| user_id | String(36) FK admin_users | 否 | |
| token | String(128) | 否 | 唯一索引 |
| expires_at | DateTime | 否 | |
| created_at | DateTime | 否 | |

---

## 教材题库

### books — 教材

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| external_id | Integer | 否 | 外部来源 ID，唯一 |
| name | String(255) | 否 | 教材名 |
| level | String(16) | 否 | 级别，索引 |
| subject | String(32) | 否 | 科目 key，索引 |
| subject_label | String(32) | 否 | 科目展示名 |
| question_count | Integer | 否 | 题目数，默认 0 |
| task_order | Integer | 是 | 任务排序 |

### questions — 教材题目

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| external_id | Integer | 否 | 外部来源 ID，唯一 |
| book_id | Integer FK books | 否 | |
| level | String(16) | 否 | 级别，索引 |
| subject | String(32) | 否 | 科目，索引 |
| stem | Text | 否 | 题干 |
| question_text | Text | 否 | 问题文本 |
| answer_text | Text | 否 | 答案文本 |
| explanation | Text | 否 | 解析，默认空 |
| source_index | Integer | 是 | 源内序号 |

### options — 教材题目选项

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| question_id | Integer FK questions | 否 | |
| text | Text | 否 | 选项内容 |
| is_correct | Integer | 否 | 1 = 正确答案，默认 0 |
| source_order | Integer | 否 | 源内选项顺序 |

---

## 教材做题记录

### attempts — 教材练习场次

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| user_id | String(36) FK users | 否 | |
| mode | String(24) | 否 | 练习模式 |
| level | String(16) | 否 | 级别，索引 |
| subject | String(32) | 否 | 科目，索引 |
| subject_label | String(32) | 否 | 科目展示名 |
| book_id | Integer FK books | 是 | 教材来源，可空 |
| title | String(255) | 否 | 场次标题 |
| correct | Integer | 否 | 答对数 |
| total | Integer | 否 | 总题数 |
| created_at | DateTime | 否 | 场次时间 |
| duration_seconds | Integer | 是 | T-14 整场时长（秒）；存量行 NULL |

### attempt_answers — 教材练习逐题作答

一次场次的逐题明细：选了什么、对错、何时作答。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| attempt_id | Integer FK attempts | 否 | |
| user_id | String(36) FK users | 否 | |
| question_id | Integer FK questions | 否 | |
| chosen_option_id | Integer FK options | 是 | 用户所选选项；NULL = 未答 |
| correct_option_id | Integer FK options | 否 | 提交时快照的正确选项 |
| is_correct | Integer | 否 | 1 = 答对 |
| created_at | DateTime | 是 | T-11 逐条作答时间；存量行 NULL |

### wrong_questions — 教材错题本

按 (user_id, question_id) 唯一的聚合错题记录。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| user_id | String(36) FK users | 否 | 唯一约束 (user_id, question_id) |
| question_id | Integer FK questions | 否 | |
| wrong_count | Integer | 否 | 累计错误次数 |
| last_chosen_option_id | Integer FK options | 是 | 最近一次错选选项 |
| last_wrong_at | DateTime | 否 | 最近做错时间 |

---

## 真题库

### exams — 真题卷

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| external_id | String(32) | 否 | 外部 ID，唯一 |
| level | String(16) | 否 | 级别，索引 |
| title | String(255) | 否 | 卷名 |
| exam_date | BigInteger | 是 | 考试日期 |
| exam_type | String(32) | 否 | 类型，默认空 |
| is_published | Integer | 否 | 1 = 已发布，默认 1 |
| media_id | Text | 否 | 听力音频 ID，默认空 |
| media_path | Text | 否 | 音频路径，默认空 |
| vocabulary_num | Integer | 是 | 词汇题数 |
| grammar_num | Integer | 是 | 语法题数 |
| reading_num | Integer | 是 | 阅读题数 |
| listening_num | Integer | 是 | 听力题数 |
| duration_json | Text | 否 | 各部分时长配置 JSON |
| layer_count | Integer | 否 | 大题（layer）数 |
| question_count | Integer | 否 | 题目总数 |

### exam_layers — 真题大题分组

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| external_id | String(64) | 否 | 唯一 |
| exam_id | Integer FK exams | 否 | |
| order_index | Integer | 否 | 卷内顺序 |
| title | Text | 否 | 大题标题 |
| question_type | Integer | 是 | 题型编码 |
| data_type | Integer | 是 | 数据类型编码 |
| questions_num | Integer | 是 | 计划题数 |
| question_count | Integer | 否 | 实际题数 |
| image_path | Text | 否 | 大题配图路径 |

### exam_questions — 真题题目

真题逐题内容 + 校正工作流状态（`answer_status` / `analysis_status` / `reviewed_by` 等，管理端真题校正核心表）。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| external_id | String(64) | 否 | 唯一 |
| exam_id | Integer FK exams | 否 | |
| layer_id | Integer FK exam_layers | 否 | |
| order_index | Integer | 否 | 卷内题序 |
| level | String(16) | 否 | 级别，索引 |
| question_type | Integer | 是 | 题型编码 |
| data_type | Integer | 是 | 数据类型编码 |
| identity_json | Text | 否 | 题目标识 JSON |
| title | Text | 否 | 题干标题 |
| passage | Text | 否 | 题目原文/材料 |
| analysis | Text | 否 | 解析 |
| translation | Text | 否 | 翻译 |
| subtitle | Text | 否 | 字幕（听力） |
| parent_external_id | String(64) | 否 | 组题父题外部 ID，默认空 |
| image_id | Text | 否 | 图片 ID |
| image_path | Text | 否 | 图片路径 |
| media_id | Text | 否 | 音频 ID |
| media_path | Text | 否 | 音频路径 |
| created_at_text | String(64) | 否 | 源创建时间文本 |
| updated_at_text | String(64) | 否 | 源更新时间文本 |
| answer_status | String(32) | 否 | 答案校对状态，默认 `unverified`，索引 |
| analysis_status | String(32) | 否 | 解析状态，默认 `missing`，索引 |
| analysis_document_json | Text | 否 | 解析富文本文档 JSON |
| review_note | Text | 否 | 校对备注 |
| reviewed_by | String(36) | 是 | 校对者（AdminUser UUID，无数据库级外键） |
| reviewed_at | DateTime | 是 | 校对时间 |
| answer_version | Integer | 否 | 答案版本号，默认 1 |

### exam_options — 真题题目选项

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| question_id | Integer FK exam_questions | 否 | |
| text | Text | 否 | 选项内容 |
| is_correct | Integer | 否 | 1 = 正确答案 |
| source_order | Integer | 否 | 源内顺序 |

### exam_question_revisions — 真题校正修订历史

每次校正前后快照，供审计/回溯。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| question_id | Integer FK exam_questions | 否 | |
| user_id | String(36) | 否 | 修订者（AdminUser UUID，无数据库级外键），索引 |
| before_json | Text | 否 | 修订前快照 |
| after_json | Text | 否 | 修订后快照 |
| note | Text | 否 | 备注 |
| created_at | DateTime | 否 | |

---

## 真题模考

流程：`exam_runs`（进行中，含逐题草稿）→ 完成后落 `exam_attempts` + `exam_attempt_answers`（正式成绩流水）。

### exam_runs — 模考进行中会话

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| user_id | String(36) FK users | 否 | |
| exam_id | Integer FK exams | 否 | |
| current_section | Integer | 否 | 当前部分序号 |
| status | String(32) | 否 | 状态，默认 `ready`，索引 |
| section_started_at | DateTime | 是 | 当前部分开始时间 |
| section_expires_at | DateTime | 是 | 当前部分截止时间（限时控制） |
| started_at | DateTime | 否 | 开考时间 |
| completed_at | DateTime | 是 | 完成时间 |
| attempt_id | Integer FK exam_attempts | 是 | 完成后关联的成绩场次 |

### exam_run_answers — 模考进行中逐题作答

进行中的作答草稿，(run_id, question_id) 唯一。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| run_id | Integer FK exam_runs | 否 | |
| question_id | Integer FK exam_questions | 否 | |
| chosen_option_id | Integer FK exam_options | 是 | 所选选项；NULL = 未答 |

### exam_attempts — 模考成绩场次

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| user_id | String(36) FK users | 否 | |
| exam_id | Integer FK exams | 否 | |
| level | String(16) | 否 | 级别，索引 |
| title | String(255) | 否 | 卷名快照 |
| correct | Integer | 否 | 答对数 |
| total | Integer | 否 | 总题数 |
| created_at | DateTime | 否 | 交卷时间 |
| duration_seconds | Integer | 是 | T-14 整场时长（秒）；存量行 NULL |

### exam_attempt_answers — 模考逐题作答

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| attempt_id | Integer FK exam_attempts | 否 | |
| user_id | String(36) FK users | 否 | |
| question_id | Integer FK exam_questions | 否 | |
| chosen_option_id | Integer FK exam_options | 是 | 所选选项；NULL = 未答 |
| correct_option_id | Integer FK exam_options | 否 | 提交时快照的正确选项 |
| is_correct | Integer | 否 | 1 = 答对 |
| created_at | DateTime | 是 | T-11 逐条作答时间；存量行 NULL |

### exam_wrong_questions — 真题错题本

按 (user_id, question_id) 唯一。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| user_id | String(36) FK users | 否 | 唯一约束 (user_id, question_id) |
| question_id | Integer FK exam_questions | 否 | |
| category | String(32) | 否 | 分类，索引 |
| wrong_count | Integer | 否 | 累计错误次数 |
| last_chosen_option_id | Integer FK exam_options | 是 | 最近一次错选选项 |
| last_wrong_at | DateTime | 否 | 最近做错时间 |

---

## 专项练习

### practice_sessions — 专项练习进行中会话

T-022 / A12：服务端为进行中会话的唯一事实源。单活跃约束：同用户至多一个 `in_progress`（POST 新会话时旧会话置 `abandoned`，并发由部分唯一索引 `uq_active_practice_session` 兜底）。无硬过期：服务端永不静默删除，72h 只影响前端建议卡。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | String(36) PK | 否 | UUID |
| user_id | String(36) FK users | 否 | |
| source | String(32) | 否 | 会话来源类型 |
| label | String(255) | 否 | 展示标签 |
| question_ids | JSON | 否 | 选题快照（保证恢复原题） |
| meta | JSON | 否 | 会话级恢复信息（流类型/config/书源），服务端不解释结构 |
| answers | JSON | 否 | 前端进度负载（作答选项 + 即时判反馈），服务端不解释结构 |
| current_index | Integer | 否 | 当前题序 |
| status | String(16) | 否 | `in_progress` / `completed` / `abandoned`，索引 |
| created_at | DateTime | 否 | |
| updated_at | DateTime | 否 | |

### practice_attempts — 专项练习成绩场次

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| user_id | String(36) FK users | 否 | |
| level | String(16) | 否 | 级别，索引 |
| category | String(32) | 否 | 分类，索引 |
| mode | String(32) | 否 | 默认 `practice` |
| title | String(255) | 否 | |
| correct | Integer | 否 | 答对数 |
| total | Integer | 否 | 总题数 |
| created_at | DateTime | 否 | |
| duration_seconds | Integer | 是 | T-14 整场时长（秒）；存量行 NULL |

### practice_attempt_answers — 专项练习逐题作答

题目/选项引用真题表（`exam_questions` / `exam_options`）。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| attempt_id | Integer FK practice_attempts | 否 | |
| user_id | String(36) FK users | 否 | |
| question_id | Integer FK exam_questions | 否 | |
| chosen_option_id | Integer FK exam_options | 是 | 所选选项；NULL = 未答 |
| correct_option_id | Integer FK exam_options | 否 | 提交时快照的正确选项 |
| is_correct | Integer | 否 | 1 = 答对 |
| created_at | DateTime | 是 | T-11 逐条作答时间；存量行 NULL |

---

## 收藏

### favorites — 收藏的题目

`source` 区分教材题（`questions`）/真题（`exam_questions`）；两题表 ID 空间独立，故 `question_id` 无数据库级外键，由应用层校验 + 列表 join 过滤悬挂行。唯一约束 (user_id, source, question_id)。

| 列 | 类型 | 空 | 说明 |
|---|---|---|---|
| id | Integer PK | 否 | |
| user_id | String(36) FK users | 否 | |
| source | String(16) | 否 | `question` / `exam_question`，索引 |
| question_id | Integer | 否 | 题目 ID（无外键，见上） |
| created_at | DateTime | 否 | 收藏时间 |
