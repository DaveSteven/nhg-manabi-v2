# 管理端 Dashboard · 运营总览（P0）

接口 `GET /api/admin/dashboard?days=7|30`（需管理员会话），页面为管理端首页。实现：`backend/app/api/admin_dashboard.py`、`apps/admin/src/features/dashboard`。

## 统计口径（后端唯一实现，前端只展示）

- 日期统一 Asia/Tokyo；窗口 = 含今天的最近 N 天。
- 有效用户 = 已验证邮箱、未停用、不在 `DASHBOARD_EXCLUDE_EMAILS`（逗号分隔，精确邮箱或 `@域名` 后缀）内。管理员在独立表，天然不计入。
- 注册用户：累计有效用户（不随范围变化）；新增用户：范围内注册。
- 学习活跃 / 正式作答题次：`study_submitted_answers` 中 `chosen_option_id` 非空的行（草稿、skip、页面浏览不计）。
- 功能使用（互斥分类）：`quick_practice`→快速练习；`mock`→模拟考试；专项会话 `config.topic.selection=wrong_only`→错题复习；其余专项→专项练习；无 topic 配置的 practice→「其他练习」（有数据才显示）。开始 = 范围内创建的会话；完成 = `state=completed`；完成率分母 = 开始次数。
- 漏斗：访问（不可用）→ 开始练习去重人数 → 完成练习去重人数；转化率 = 完成人数 / 开始人数（同一窗口）。
- 提醒：范围内新注册且从未创建过会话的人数；当前有进行中练习的人数。

## 暂不可用（不造数）

- 未采集访问事件：访问活跃折线、漏斗「访问」阶段返回 `null`，页面明确标注。需要后续补轻量埋点（P1）。
- 资源（题库/图片/音频）异常提醒、完成率异常下降提醒、与用户管理页联动未做。
- 无测试账号字段，仅能通过环境变量按邮箱排除。
