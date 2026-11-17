# ADR-0015 取消专项练习单活跃限制：Session 保存学习数据，不限制用户开始练习

状态：**已被 ADR-0016 取代**（同日；原已接受，用户 2026-11-17 指示）。本文仅作历史记录，其「多个进行中练习」条款不再有效。取代 P-010「普通练习最多一个活跃会话」及 ADR-0014 中
「专项练习 `ux_one_active_practice` 不变」一句。

## 背景

P-010 要求每个账号最多一个 `mode='practice'` 的进行中会话，开始新练习时弹出「继续旧练习 / 结束旧练习后开始 / 取消」。
这让 Session 变成限制用户自由选择练习的闸门：想先做文法就必须处理未完成的词汇练习。

## 决定

1. 同一用户可同时存在任意多个 `in_progress` 的 `practice` 会话。Alembic 0010 删除部分唯一索引
   `ux_one_active_practice`，新增非唯一部分索引 `ix_sessions_user_active_practice`（服务「最新进行中会话」查询）。
2. `POST /api/practice/sessions` 与 `POST /api/topic-practice/sessions` 不再做活跃会话预检查、不再返回
   409 `active_session_exists`，也不再有 `replace_active`（旧客户端多传该字段会被忽略，不会结束任何会话）。
   新建练习绝不自动结束、删除或覆盖其他会话。
3. 前端删除冲突弹窗与继续/结束/取消流程；「开始练习」不因旧会话而禁用，也不自动跳到别的练习。
4. 每个 Session 独立保存 Unit 顺序、草稿、反馈模式与完成状态；正式提交、评分、历史仍绑定各自 Session（提交幂等、身份隔离不变）。
5. 恢复由用户主动选择：按 Session ID 恢复、刷新当前练习恢复草稿保持不变。`GET /api/practice/sessions/current`
   仅返回「最近创建的进行中普通练习」，供首页「继续上次练习」等入口使用，不是开始新练习的前置条件。
6. 不变：`ux_one_active_quick`（Quick Practice 静默替换，无草稿）与 `ux_one_active_mock`（严格模考单名额）。

## 后果

- 可能积累多个未完成会话；是否提供进行中列表/历史入口由页面决定（本次未做，首页仍只展示最近一个）。
- 迁移回滚：downgrade 会把每个用户除最新外的进行中 practice 会话置为 `ended_early`（保留已提交答案、不生成成绩）后重建唯一索引。
- 统一反馈（`end`）会话之间互不影响：切换/新建练习不会提交另一个会话；答案仅在各自会话正式结束后揭晓。
