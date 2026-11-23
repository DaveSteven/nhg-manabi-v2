# 决策记录 · JLPT GO 2.0

只列当前有效方向；“待确认”不构成 Agent 自动实施授权。改变规则应新增 ADR 或修订记录，并同步相应规范。

| ID | 当前决策 | 状态 | 依据/注意事项 |
|---|---|---|---|
| P-001 | 2.0 独立于运行中的 1.0；根目录及仓库名 `nhg-manabi-v2` | 已确认 | 1.0 不修改，v2 开发数据库独立 |
| P-002 | 顶部导航：首页／专项练习／历年试卷／我的学习；首页四科主入口 | 已确认 | 不使用全局侧边栏、大 Hero、大 Dashboard |
| P-003 | 新视觉「樱与墨」，暖白、墨色、节制樱色；页面级下划线 Tab | 已确认方向 | 不沿用 1.0 实心按压 Tab；2026-11-16 视觉语言 v1.1：顶部导航为居中胶囊容器（Active 浅樱底、无选中线），页面级 Tab 仍为下划线；基准 Token 清单见设计规范 §13.1 |
| P-004 | 内容模型 Exam → Section → Layer → Unit → Question → Option，独立题也建 Unit | 已确认用于设计 | 五套跨等级样本完成结构转换验证 |
| P-005 | Canonical v2.0 自有交换格式，来源包只读保留；内容校验独立 | 已确认 | 旧来源 ID 不成为运行时主键 |
| P-006 | 一次随机练习只选一个题型和数量；20%-30% 已练薄弱题软配额 | 已确认方向 | 不显示复杂权重，算法参数待实测 |
| P-007 | 选择 ≠ 提交；按 Unit 即时反馈；统一反馈至整次提交后揭晓 | 已确认 | 不提前泄露同篇材料后续答案 |
| P-008 | 可以带未答提交；未答 ≠ 错误；正式提交后锁定 | 已确认 | 提交确认展示未答数量 |
| P-009 | 记录所有历史答错；最近仍错/最近已对按最后有效回答判断 | 已确认 | skip 不覆盖最近正误 |
| P-010 | 每个用户只保留**一份**可恢复的专项/普通练习 Session（单一最近进度）：开始新练习时同事务把旧进行中 Session 置 `abandoned` 再创建，无冲突弹窗；已提交答案/历史保留，未提交草稿不计成绩；完成后保存正式结果并不再可恢复；不做多练习列表/清理 | 已确认（ADR-0016，取代 ADR-0015 与原冲突弹窗方案） | Quick Practice 与严格模考单名额不变；临时进度只留一份，正式成绩全部保留 |
| P-011 | 严格模考与普通练习规则分离；服务器控制时间，交卷前禁止答案 | 已确认边界 | 具体时长、音频规则、无时长不能启动“严格模拟” |
| P-012 | React + TypeScript / FastAPI / PostgreSQL；模块化单体，Alembic 迁移 | 当前采用架构 | 不照搬 1.0 状态库或旧表 |
| P-013 | 发布采用不可变 Release；每个跨卷抽样 Unit 保存自己的 release | 当前采用架构 | 旧答卷引用旧版本，不能静默重算 |
| P-014 | AI 精读、支付、排行榜等非 2.0 首期默认需求 | 已确认边界 | 单独评审后才能加入 |
| P-015 | 审核事件按 DB 插入顺序（sequence）定最终状态；阻断结论必须落可追踪 `content_issues`；Agent pass 不自动清除争议；结论严格绑定内容哈希；数据质量异常入库存档 | 已确认（ADR-0005） | 见 ADR-0005；blocking 未解决记录拒绝发布 |
| P-016 | M2 作答域 `user_id` 由服务端认证上下文解析；默认 fail-closed；`dev_test` 测试身份机制在生产环境硬禁用；暂不建 users 表 | 已确认（ADR-0006） | 见 ADR-0006；正式认证接入时只替换 `get_current_user_id` |
| P-017 | 用户端前端采用 React Router Framework Mode + SSG（品牌/内容页）+ SPA（学习系统）；第一阶段禁用运行时 SSR，不引入 Next.js 或 Node SSR 服务 | 已确认（ADR-0007） | 见 ADR-0007；影响 apps/web 与前端/部署配置；迁移全站 SSR 或 Next.js 须新 ADR |
| P-018 | 独立管理端 `apps/admin` 界面框架为 Ant Design 6（2026-11-18 起，ADR-0028 取代 ADR-0008 的 shadcn-admin 选择），不套用学生端「樱与墨」配色；路由/Query/API/权限约定不变 | 已确认（ADR-0028，原 ADR-0008） | 不采用 antd-admin 的 Mock/模拟权限；FastAPI 权限与发布规则仍是事实源 |
| P-019 | 管理员使用独立的 `admin_users`/`admin_sessions` 表，角色 viewer ⊂ reviewer ⊂ publisher；无 dev 旁路，命令行创建；审核人由服务端注入 | 已确认（ADR-0009） | 学生与管理员身份隔离；QA Agent 无管理账号；MFA/SSO/口令找回不在范围 |
| P-020 | 入库默认发布（`PUBLISH_POLICY=auto`，可回退 `gated`）；暂不做审核流程；管理员仅 `super_admin` | 已确认（ADR-0010） | 未校验答案会直接展示并判题；版权门槛暂停；auto 不把任何内容标成已验证，只在决策备注里如实记录未验证项；部署仍需另行授权 |
| P-021 | 学生账户：邮箱登录（无用户名）、完整邮件验证/找回流程（Resend）、30 天不透明 Bearer 会话存 localStorage、scrypt 口令（与管理端同实现）、等级偏好 `users.current_level` + 本地双轨；不迁移 v1 旧用户（用户名与迁移部分已由 P-029 / ADR-0029 取代） | 已确认（ADR-0011） | 未激活/停用不可登录；登录锁 5 次/15 分钟；IP 级限流随部署硬化另行处理；`dev_test` 仍生产硬禁用 |
| P-022 | Quick Practice（历年试卷单 Unit 快速练习）使用独立 `quick_practice` 会话模式：无服务端草稿/恢复/冲突弹窗，点 Unit 直入、提交即完成并计正式历史；目录显示真实练习次数（未练习/已练习 N 次）、Layer 显示「已练习 X / Y 组」；不占专项练习单活跃名额 | 已确认（ADR-0014） | `study_answer_drafts` 表保留给专项练习；静默替换仅限 quick 会话之间；练习次数由服务端 practice-status 计算，前端不累加 |
| P-023 | 严格模拟规则：按官方结构分 Phase 与时限（N1 110+55 / N2 105+50 / N3 30+70+40 / N4 25+55+35 / N5 20+40+30 分钟，来源 JLPT 官网）；时限随 release 存储；听力只播一次；服务器超时封存；Phase 不可回看且不顺延；不做换算分；模考使用独立名额、与练习/Quick 互不冲突（ADR-0020 取代原 M8），已有进行中模考时再开始需继续或显式替换；交卷前不泄漏答案；缺 Phase 的试卷不开放 | 已确认（ADR-0019，M8 由 ADR-0020 取代） | 规则已定、实现未开始；需转换器生成 Phase、新 release、模考专用 DTO 与单进程约束迁移；误触替换会放弃计时中的模考（按用户指示不加确认） |
| P-024 | 模拟考试共享材料题按材料结构自动布局（ADR-0021）：只分 `standalone` / `shared-material` / `cloze` 三种模式，不按长篇/短篇等题型名分类；文字或图片材料均左右双栏（58/42，纯图片 62/38），右栏 Sticky 限本 Unit；多题 Unit 放得下全显示、放不下才逐题切换；选项按字数决定单列或 2×2；图片页内放大 | 已确认（用户 2026-11-18 方案 + 评审修订） | 仅模考页；普通/专项练习仍按 ADR-0018；图片尺寸未入库，加载时布局仍可能移动 |
| P-029 | 模考成绩页：原始正确率+科目表现+复用专项的逐题回顾（解析/听力原文仅整场完成后开放）；练习历史纳入已完成模考并可筛选；试卷详情列历次模考；不做换算分/合格判定（ADR-0027） | 已确认（用户 2026-11-18） | 无 Schema 变更；放弃的模考仍不可见；模考不写 `user_question_progress` |
| P-028 | 专项练习「练习结果」与「答案解析」合并为单页 `/study/practice/:id/results`（ADR-0026）：成绩概览（正确率按已作答口径）→ 题号导航（✓/×/中性，默认首个错题）→ 当前题与解析 → 「再练一组」「返回专项练习」；完成后旧练习地址跳转合并页；解析仍走服务端 feedback 门控；Quick Practice、非专项会话、模考不变 | 已确认（用户 2026-11-18） | 无后端改动；历史结果只读不重算 |
| P-027 | 模考听力阶段确认后才计时；考试中与说明页均可「放弃考试」（ADR-0024）：确认页期间时钟不走（接口返回完整时长，首次登记播放时重置起止时间）；放弃只终止考试，不重开，已交阶段答案保留 | 已确认（用户 2026-11-18） | 确认页可无限停留；不防绕过前端直存草稿 |
| P-026 | 模拟考试共享材料题「一份材料一页」（ADR-0023，取代 ADR-0021 第 3 条「放得下全显示」）：共享材料大题一页只显示一个 Unit，底部「上一篇/下一篇」切换；多题 Unit 右栏恒为一次一题，上一题/下一题 + `第 N 题 · i/n`，末题的下一题换为「下一篇」；独立题仍一屏连续作答；答题卡跳转定位到 Unit 与题；切换保存并恢复各材料的当前题 | 已确认（用户 2026-11-18 再次确认原方案） | 仅模考页；窄屏同样一次一题；ADR-0021 其余条款仍有效 |
| P-025 | 模拟考试听力连续播放（ADR-0022）：有可用完整录音的听力阶段只播一段完整录音（含大题说明、例题与作答间隔），服务器单一时间线、只播一次；先确认页，确认点击即自动播放；底部短胶囊 Mini Player 只有播放按钮与只读进度条；不可暂停/拖动/倍速/重播（播放器逻辑层强制）；不做题号跟随；无可用完整录音时沿用逐题严格播放器 | 已确认（用户 2026-11-18） | 阶段倒计时在确认页已开始；直接请求媒体 URL 不受限（与练习同一接口） |
| P-029 | 学生可用邮箱或用户名登录（`users.username` 小写唯一、不含 `@`；`email` 可空，允许长期无邮箱）；V1 老用户导入时保留 PBKDF2 哈希，首次登录自动升级为 scrypt；无邮箱账号由管理端重置密码；学习记录不迁移 | 已确认（ADR-0029） | 导入脚本默认 dry-run；V1 与 v2 并行期间口令不同步；绑定邮箱/改用户名自助入口未做 |
| P-030 | V1 教材题作为「扩展练习」（内部 `supplementary`）：复用 Canonical/Release 流程，按课成卷（单题 Unit，年月为空）；**独立入口，不进入历年试卷目录，也不进入专项练习抽样**；V1 无解析不伪造 | 部分确认（ADR-0030；独立入口已确认，展示名待确认） | 阶段一仅后端与转换样例；学生端入口、全量转换和作答迁移未做；3618 题答案未核对 |
| P-031 | 生产目标：v2 部署在 V1 所在服务器并替换 V1，沿用 `jpn.manabi.cc` / `admin.manabi.cc`；并存部署、最后切换，V1 只停不删，回滚=nginx 切回 V1 | 已确认（ADR-0031） | 具体窗口、邮件密钥、媒体传输等需逐项授权；服务器内存仅 1.9 GB |
| P-032 | 站点根路径 `/` 直接 302 跳转到 `/study`（用户 2026-11-21 决定），品牌首页暂不对外展示 | 已确认（nginx 层实现，无 ADR） | 可随时撤回；ADR-0007 的「`/` 为品牌首页」在对外访问上暂不生效 |
| P-033 | 生产回退：2026-11-23 起 V1 重新对外服务（数据为 11/14 备份），v2 API 停止、v2 数据库与备份保留；对外域名仍是 `jpn.manabi.cc` / `admin.manabi.cc` | 已确认（用户决定，接受近一周作答在 V1 中不可见） | 取代 P-031 的「v2 替换 V1」在现网上的状态；v2 数据完整，可随时切回；V1 新库暂无定期备份 |

## 尚未定稿的重点

- 读解题型 `32–36` 语义字典最终名称；N1/N2 A/B 材料启发式拆分复核。
- 官方换算分不可未经验证伪造（严格模拟时限/播放/暂停规则已由 ADR-0019 确定）。
- 旧用户及历史数据迁移、完整注册策略；内容/媒体授权审查机制。
- 主题暗色具体色板、容器上限和响应式断点、统计时间范围。
- “练习本大题”快捷入口、普通听力倍速/拖动等交互细节。

## ADR 导航

- `ADR-0001-project-isolation.md`
- `ADR-0002-canonical-unit.md`
- `ADR-0003-submission-and-history.md`
- `ADR-0004-content-releases.md`
- `ADR-0005-review-event-ordering-and-issues.md`
- `ADR-0006-minimal-user-identity-boundary.md`
- `ADR-0007-hybrid-rendering-strategy.md`
- `ADR-0008-shadcn-admin-foundation.md`（界面框架部分已被 ADR-0028 取代）
- `ADR-0009-admin-identity-table.md`
- `ADR-0010-auto-publish-and-super-admin.md`
- `ADR-0012-local-docker-deployment.md`
- `ADR-0013-user-center-and-avatar.md`
- `ADR-0014-quick-practice-lightweight-mode.md`
- `ADR-0015-multiple-active-practice-sessions.md`（已被 ADR-0016 取代）
- `ADR-0016-single-recent-practice-session.md`
- `ADR-0017-unit-per-page-all-questions.md`
- `ADR-0018-sticky-answer-panel.md`
- `ADR-0019-strict-mock-exam-rules.md`（M8 已被 ADR-0020 取代）
- `ADR-0020-mock-exam-independent-slot.md`
- `ADR-0021-mock-shared-material-layout.md`（模考页修订 ADR-0018）
- `ADR-0022-mock-continuous-listening.md`
- `ADR-0023-mock-one-material-per-page.md`（取代 ADR-0021 第 3 条）
- `ADR-0024-mock-listening-clock-and-abandon.md`
- `ADR-0026-topic-result-review-merged.md`（专项练习结果页与解析页合并）
- `ADR-0027-mock-result-review-and-history.md`（模考成绩逐题回顾与历史整合）
- `ADR-0025-abandoned-mock-not-recorded.md`（放弃的模考不保留可见记录；practice 接口隔离模考）
- `ADR-0028-admin-ui-antd.md`（管理端界面框架改为 Ant Design）
- `ADR-0029-username-login-and-v1-user-migration.md`（用户名登录与 V1 用户迁移，取代 ADR-0011 的相应两条）
- `ADR-0030-supplementary-practice.md`（V1 教材题作为扩展练习）
- `ADR-0031-v2-replaces-v1-on-existing-server.md`（v2 在现有服务器上替换 V1）
