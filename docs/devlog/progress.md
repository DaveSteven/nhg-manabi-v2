# 项目总体进度

最后更新：2026-11-19

## V1 教材作答迁移脚本（2026-11-19）

- `app/v1_answer_import.py`：V1 教材练习导入为已完成会话 + 正式答案（进度缓存由答案重建，避免被覆盖），对错按 v2 答案 Key 重判，异常作答分类跳过，默认 dry-run，见 [日志](2026-11-19-v1-textbook-answers-import.md)。后端 323 passed + 2 skipped；已对线上 V1 做只读 dry-run（测试库）：69 会话/538 作答全部可导入，0 跳过、0 改判；**用户、扩展内容与作答尚未导入开发库/生产**。

## 扩展练习学生端入口（2026-11-19）

- `/study/supplementary`（专项练习页内文字入口）：按等级、科目选课，整卡片开始，一课=全部可练习 Unit 的普通练习会话；与「我的学习」、专项抽样、历年试卷目录隔离，见 [日志](2026-11-19-supplementary-student-entry.md)。后端 320 passed + 2 skipped，web 360 tests、tsc、build 通过，已用合成课在真实浏览器走查；**真实 3618 题未导入开发库/生产、V1 作答未迁**，无移动端验收。

## 扩展练习（V1 教材题）阶段一（2026-11-19）

- ADR-0030：V1 教材题作为独立的「扩展练习」（`supplementary`），独立入口、不进历年试卷目录与专项抽样；迁移 0020、校验与过滤、转换器已实现，对线上 V1 试转换 362 课 / 3617 题通过结构校验，一课已在测试库导入验证，见 [日志](2026-11-19-supplementary-practice-phase1.md)。后端 307 passed + 2 skipped；**学生端入口、全量导入、作答迁移未做，未导入开发库/生产**，经用户确认修订后全量试转换 3618/3618 题、0 排除、0 待复核（见日志补充二）。

## 首页考试倒计时与连续学习（2026-11-18）

- `/study` 继续练习卡下新增「距考试 N 天」与「连续学习 + 本周 7 天」两卡，新增 `GET /api/me/learning/streak`（正式有选择答案、东京日界），见 [日志](2026-11-18-home-countdown-streak.md)。后端 299 passed + 2 skipped，web 353 tests、tsc、build 通过；考试场次日期为手工维护数据，浏览器视觉与多日连续数据未验收。

## 用户名登录与 V1 用户迁移准备（2026-11-18）

- 学生可用邮箱或用户名登录，`email` 可空；V1 PBKDF2 哈希可直接校验并在首次登录升级为 scrypt；管理端可看/搜用户名并重置密码；新增 V1 导入脚本（默认 dry-run），见 [日志](2026-11-18-username-login-v1-migration.md) 与 ADR-0029。后端 298 passed + 2 skipped，web 348、admin 51 单测，tsc/build 通过；**尚未对真实 V1 库导入，也未升级生产**，导入是部署后单独授权的步骤，浏览器未验收。

## 管理端迁移到 Ant Design（2026-11-18）

- `apps/admin` 界面层由 shadcn-admin 换为 Ant Design 6（ADR-0028），登录、Dashboard、试卷管理、用户管理（列表/详情/禁用启用）全部迁移，API 与后端不变，见 [日志](2026-11-18-admin-antd-migration.md)。tsc、eslint、admin 49 单测、build 通过；已在真实后端走查登录、下架/恢复、禁用/启用、深色与移动端（均已还原数据）；Docker 构建、Firefox/Safari 未验证。

## 管理端用户管理 P0–P2（2026-11-18）

- 管理端新增「用户管理」：列表（搜索/等级/活跃与账号状态筛选/排序/分页，活跃口径与 Dashboard 一致）、详情（30 天趋势、功能与科目分布、最近练习）、账号启用/禁用（二次确认、撤销会话、审计表迁移 0018），见 [日志](2026-11-18-admin-users.md) 与 [口径](../development/admin-users.md)。后端 287 passed + 2 skipped，admin 43 单测、tsc、build 通过；浏览器未验收，只读结果详情跳转未做。

## 管理端 Dashboard 访问埋点（2026-11-18）

- 新增 `user_visit_days`（迁移 0017，本地开发库已升级、downgrade/upgrade 验证）与 `POST /api/me/visit`，学生端 `/study` 每日一次上报；Dashboard 现显示访问活跃折线与「访问→开始→完成」漏斗，采集起点之前的日期不造数，见 [日志](2026-11-18-dashboard-visit-tracking.md)。后端 280 passed + 2 skipped，web 347 tests，admin 36 单测，tsc/build 通过；浏览器未验收，仅登录用户计入访问。

## 管理端 Dashboard P0（2026-11-18）

- 管理端首页改为运营总览：四项指标、7/30 天切换、每日学习活跃、功能使用、漏斗、两条提醒；访问活跃/访问漏斗因无埋点明示不可用，见 [日志](2026-11-18-admin-dashboard-p0.md) 与 [口径](../development/admin-dashboard.md)。后端 279 passed + 2 skipped，admin 35 单测、tsc、build 通过；浏览器视觉未验收，P1（访问埋点、资源异常、用户管理联动）未做。

## 模考成绩逐题回顾与历史整合（2026-11-18）

- 回顾页取消自动滚动：点题号/上一题/下一题/切科目/切筛选只换内容，见 [日志](2026-11-18-mock-review-no-autoscroll.md)；前端 344 tests、tsc 通过，容器已重建，视觉未目检。

- 第二轮紧凑化：科目卡片+四项筛选+当前题复盘，去掉科目表与全卷题号墙，见 [日志](2026-11-18-mock-review-compact.md)；前端 343 tests、tsc、build 通过，容器已重建，视觉未目检。

- 模考成绩页重做为概览→科目表现→逐题回顾（复用专项 `ReviewQuestion`）；练习历史纳入已完成模考并可筛选；试卷详情新增历次模考记录，见 [日志](2026-11-18-mock-result-review-history.md) 与 ADR-0027。后端 274 passed + 2 skipped（真实 PG），前端 341 tests、tsc、build 通过；真实浏览器/视觉与真实听力回顾未验收，无换算分与合格判定。

## 专项练习结果页与解析页合并（2026-11-18）

- 专项练习完成后直接进入合并页（成绩概览 → 题号导航 → 题目与解析 → 再练一组/返回），见 [日志](2026-11-18-topic-result-review-merge.md) 与 ADR-0026；前端 335 tests、tsc、build 通过，后端未改动；真实浏览器与视觉验收未做。

## 最新文档更新（2026-11-17）

- 学生端/管理端换用 MINAO 标志与 favicon（`2026-11-17-minao-logo-favicon.md`）；类型检查与单测、web build 通过，未做浏览器视觉核对。

- 练习/结果页按来源高亮顶栏「专项」或「试卷」（`2026-11-17-topnav-section-highlight.md`）。

- 未登录顶栏不再显示等级选择（详见 `2026-11-17-guest-no-level-selector.md`）。

- 长篇读解/文章填空桌面双栏 Sticky 答题面板（ADR-0018）：`SharedMaterialLayout`，slot↔题联动；前端 253 passed、build 通过，真实浏览器验收见 `2026-11-17-sticky-panel.md`。

- 成组题一页展示全部小题（ADR-0017）：统一反馈专项与 Quick 多题 Unit 不再逐小题切换，按 Unit 翻页；前端 250 passed、typecheck 通过，未做浏览器视觉验收，详见 `2026-11-17-unit-per-page.md`。

- 按钮标准化实现：学生端 `Button`/`ButtonLink` 组件与 `_button.scss` 已落地，练习、结果、专项配置、认证、账户与顶栏已迁移（typecheck/246+3 测试/build 通过）；未做浏览器视觉与 375px/缩放验收，详见 `2026-11-17-button-standardization-impl.md`。
- 按钮标准（文档）：新增 `docs/design/button-spec.md`，统一胶囊操作按钮、44px 默认尺寸、主次层级、六种状态、题号/题型卡片的独立规则与专项/结果页映射；设计总则和文档入口已同步。仅文档落地，组件迁移及浏览器验收未执行。

## 当前核查结论（2026-11-18）

- 基线 `develop@839da1f`；本次重点审查作答与模考链路，详见 [阶段代码审查与下一步建议](2026-11-18-stage-code-review.md)。
- 专项练习、智能抽样、只复习最近仍错、`user_question_progress` 维护/重建、学习概览/练习历史/题目记录已有实现；不再列为待开发。
- 严格模考已有 Phase 状态机、服务器计时、阶段提交、独立名额、连续听力、确认后计时及放弃流程。成绩页逐题回顾与模考历史入口已由 ADR-0027 实现（待浏览器验收）。
- 审查项状态：R1（失败草稿刷新丢失）、R2（保存中改回原选项）、R3（普通 finish/feedback 触及模考）已修复，见 [可靠性修复](2026-11-18-reliability-fix-r1-r3.md) 与 ADR-0025；R4（模考开放未检查听力素材可用性）已修复，见 [R4 日志](2026-11-18-reliability-fix-r4.md)：开放前检查连续录音或分题素材可播放，不满足则模考不可用。
- 最新验证：学生端 327 tests、`tsc` 通过；后端真实本地 PG `269 passed, 2 skipped`。管理端本轮未改动、未重跑。
- 未做真实浏览器、真实听感、生产构建、迁移及上线验收。当前属于功能主体已实现、可靠性与端到端验收待收口阶段。

## 历史完成记录

以下按开发时点保留，数字和“尚未”描述只代表当时状态；当前安排以上方核查结论和后续清单为准。

- 项目文档体系（architecture / product / design / data / development / decisions ADR-0001~0004）。
- 后端骨架：FastAPI `/health`、SQLAlchemy 32 表 metadata、Alembic 0001 初始迁移（静态 DDL）。
- Docker Compose PostgreSQL 16（容器 `nhg-manabi-v2-db`，`127.0.0.1:55432`）。
- 数据库真实落地：迁移升级/回滚/再升级验证通过；32 表、32 CHECK、46 外键、60 索引。
- **Canonical staging importer**：验包/哈希/结构校验/幂等 staging 全流程；真实五套样本（N5–N1）已 staged，计数与规范基准吻合（20 Section/83 Layer/440 Unit/498 Question/204 Asset）；重复导入幂等；失败回滚带诊断；published 表保持为空。
- **Raw → Canonical 转换落地**：`scripts/canonical_v2.py` 收编入仓；对 Raw 原始数据（data/samples/N{1..5}）按级各抽一套完成转换，产物与既有 Canonical 包字节级一致（除时间戳），content_hash 逐包相同，端到端确定性验证成立。
- **M1.5 内容清洗审计与字幕时间轴**：原始 HTML 属性全量清单（A/B/C 分类）；Canonical 残留扫描零发现；字幕时间轴覆盖率 100%（1202 cue，143 Unit 全部配对音频，基准=Unit 音频）；越界 21 经 ffprobe 实测校对——17 个编码 padding 级可解释、4 个确证问题（N4 末段 cue 超出真实音频 ≤1282ms）待人工重对；大间隔 20 标 needs_review 固化回归；逐段播放数据兼容性测试通过；五包重转内容字节级一致（内容哈希零变化）；转换器 +0.1.1（属性审计）、验证器增强（缺失 vs 0、大间隔、时长越界）。
- **M1.6 审核与数据校验稳定化**：Alembic 0003（`content_issues` 表 + `content_reviews.sequence` 确定性顺序 + blocking 必须关联 Issue 的 CHECK）；`review_state.py` 按 sequence 的状态解析与显式 `resolve_issue`；Agent pass 不再能清除未解决争议；发布答案回查按 Unit 输入哈希过滤（旧哈希结论不跨版本泄漏）；promote 新增「当前哈希存在 open blocking 记录拒绝发布」门槛；`data_quality.py` 把验证器异常（cue 越界/缺失/非法/大间隔、材料分组等）幂等同步为可查询数据质量记录，重校验自动 resolved；N4 真实包已同步（20 条，4 个确证字幕越界 open blocking 可查询，幅度与 ffprobe 审计吻合）；ADR-0005。
- 测试：55 个测试全部通过（review_sync 12、data_quality 3、播放兼容 2、publisher/API 7、导入器 20、迁移一致性 2、Schema 编译 3、健康检查 1、真实 PG 约束 5 等在内）。
- **M2.1 Task 01–04（2026-11-16）**：开发前检查；题库查询 API 扩展（`GET /api/exams/{id}` 轮廓、`/layers` 目录、`GET /api/releases/{rid}/units/{uid}` 按 release 取 Unit，公开载荷零答案泄漏，draft 仍 404）；最小用户身份边界（`app/auth.py`，服务端解析 + fail-closed + dev_test 生产硬禁用，ADR-0006）；练习会话管理（`app/api/practice.py`：创建固定 release 绑定的单/多 Unit 会话、单活跃练习 409 冲突、恢复、跨账号 404 隔离、finish→ended_early 幂等且不生成虚假成绩）。测试增至 74 个全部通过。
- **ADR-0007 用户端混合渲染策略（2026-11-16，纯文档）**：React Router Framework Mode + SSG（品牌/内容页）+ SPA（学习系统），第一阶段禁用运行时 SSR，不引入 Next.js/Node SSR 服务。原建议编号 0005/0006 已被占用，顺延为 0007（M2 计划 Task 09 引用已修正）。`frontend-spec.md` 新增「页面渲染策略」章节为实现规范（页面分类、SSG/SPA 规范、SEO/多语言、静态部署路由规则、验收清单、SSR 升级条件）。两份并行起草的 ADR 已合并为单一 `ADR-0007-hybrid-rendering-strategy.md`。原「Task 09 前先写混合渲染 ADR」提前满足（实现仍在 M2.2）。无代码改动、未运行测试。
- **M2.1 Task 05–08（2026-11-16）**：答案草稿管理（`row_version` 乐观锁，409 带当前版本，旧请求不可覆盖新数据，清除/恢复/冻结齐全）；Unit 正式提交（**单事务整组提交 + 服务端判题**：会话行先锁、单元行后锁，并发/重复提交幂等返回存储结果且零重复作答行；非法选项整组回滚可重试；未答 = NULL/NULL ≠ 错误；无答案键拒绝判题）；反馈权限（正确答案/解析只经 feedback 端点门控下发——immediate 提交后开放该 Unit，end 模式会话正式结束前零泄漏含提交响应体）；练习结果（全部提交 → completed + 同事务 `study_results`，DB CHECK 保证 correct+wrong+skipped=total；有未提交 → ended_early 保留已提交答案且不生成成绩；结果含逐题复盘与 score_rate/answered_accuracy）。测试增至 87 个全部通过（新增 study_flow 13）。已知边界：Idempotency-Key 头未实现（域级幂等替代）、`user_question_progress` 留待 M3。
- **ADR-0008 管理端技术基线（2026-11-16，纯文档）**：`apps/admin` 确认采用固定、经审查版本的 `satnaing/shadcn-admin` 作为独立 SPA 工程/UI 基础，保留上游默认主题，不套用「樱与墨」；实际引入时移除 Clerk/示例凭据/演示数据，保留 MIT 许可记录，并继续以 FastAPI 为管理身份、审核和发布权限事实源。实施计划见 `docs/development/admin-frontend-implementation.md`；当前尚未生成管理端工程。
- **M2 媒体读取前置依赖（2026-11-16，M2.2 Task 09–11 的 Commit A）**：来源核实确认 Canonical 包不含媒体二进制、映射需按 SHA-256 内容寻址回溯 Raw `resources.json`；Alembic `0004` 新增 `media_storage` 映射表（状态/实测哈希/大小/MIME/时长 + 可查询 `last_error` 诊断）；新增独立同步步骤 `python -m app.media_sync`（校验后临时文件+原子落盘到 `MEDIA_STORAGE_DIR` 的 `<sha[:2]>/<sha[2:4]>/<sha256>.<ext>`，重复导入幂等、损坏自修复、失败标记 unavailable；只读 Raw 来源，不写 published 表）；新增 `GET /api/releases/{release_id}/assets/{asset_id}`（published + complete Unit 关联 + storage 哈希校验四重门槛，拒绝统一 404，RFC 9110 Range 206/416 支持浏览器拖动，历史 release 可读）。测试库/开发库迁移升级+回滚验证通过；全量回归 103 passed + 2 skipped（skip 因本地缺 Canonical Archive.zip，环境变化，与本次无关）。真实样本媒体同步与浏览器播放冒烟待执行（见 devlog），字幕 cues 仍未公开。

## 阶段实施与验收记录（按日期保留）

- **前端 SCSS 落地（2026-11-16）**：`apps/web` 已安装 Dart Sass，`tokens.css`/`global.css` 迁移为 SCSS；练习、对话框、反馈和结果样式拆至 `_practice.scss`，使用 `@use` 和嵌套组织作用域。新增或修改样式继续遵守 SCSS 规范。
- **M2 核心学习流程**（计划见 `docs/development/M2-core-learning-flow.md`）：FastAPI 作答引擎 → React 学习页面 → 端到端验收。**M2.1 全部完成（Task 01–08）**；M2.2 Commit A、1、2、3、4 已完成，M2.3 首轮隔离库端到端已完成，下一步：多浏览器/多视口走查、听力出声确认、SSG 部署验收与视觉走查。
- **M2.2 前端实施准备（2026-11-16）**：新增 `docs/development/M2.2-frontend-implementation.md`，已明确 React Router Framework Mode SSG+SPA、学习首页、试卷目录、Canonical Unit/RichText/听力渲染、草稿与提交反馈、自动恢复及测试验收。
- **M2.2 Commit A 媒体前置（2026-11-16）**：Alembic `0004` `media_storage` 映射表；`python -m app.media_sync` 独立同步步骤（SHA-256 内容寻址、校验后原子落盘、幂等/自修复/失败诊断）；`GET /api/releases/{rid}/assets/{aid}` 四重门槛公开媒体接口（统一 404、RFC 9110 Range、历史 release 可读）；迁移升级/回滚验证通过；回归 103 passed + 2 skipped（环境性 skip）。接口契约已写入 M2.2 计划 §6/§8；真实样本同步与浏览器冒烟待执行。
- **M2.2 Commit 1 前端脚手架（2026-11-16）**：pnpm workspace + `apps/web`（React Router 7 Framework Mode，`ssr:false` + `prerender:["/"]`，`entry.server.tsx` 仅构建期 prerender 用，无运行时 Node SSR）；樱与墨 tokens 与全局样式；四项顶导航（未实现入口「暂未开放」）；API adapter（zod strictObject DTO，拒绝 cues/答案字段泄漏；三种后端错误形状归一化；dev_test token）；Vite dev proxy `/api`→8001（不加 CORS）；构建验收脚本（预渲染品牌 HTML、noindex SPA fallback、凭据泄漏扫描）。typecheck 通过；vitest 37 passed；`pnpm build` 含产物检查通过。品牌页为最小占位，真实文案待设计输入。
- **Claude 项目开发入口与分支流程（2026-11-16）**：根目录 `CLAUDE.md` 与 `.claude/skills/nhg-manabi-development/SKILL.md` 强制 Claude Code 先读取 `AGENTS.md`，再执行文档路由、工作树保护、测试真实性与收尾要求；日常开发/提交统一使用 `develop`，`main` 仅记录成功上线状态，只有上线验收完成并获用户明确确认后才合并。
- **M2.2 Commit 2 学习首页与试卷目录（2026-11-16）**：`features/catalog`（学习首页四学科入口+继续练习卡片+并行请求独立状态；试卷列表 URL 筛选；下划线 Tab/Layer 展开/Unit 列表）、`features/practice` 409 活跃会话冲突对话框（继续/结束旧练习，ended_early 语义显式确认）；MSW 集成测试 14 例。vitest 51 passed。实现期发现 jsdom 与 Node undici 的 AbortSignal realm 冲突会使 react-router 数据路由全部导航静默失败，vitest 环境改用 happy-dom（记录于 devlog）。真实后端走查合并至 Commit 4。

- **M2.2 Commit 3 Canonical 渲染器（2026-11-16）**：RichText v1 白名单安全渲染（零 dangerouslySetInnerHTML、未知节点安全降级、slot 对 unit.slot_ids 完整性校验）、中性 view model（printed_number 透传、prompt=null 合法）、A/B 双文与衬线阅读排版、固定底部音频 dock（播放/拖动/缓冲/失败态，safe-area 预留）、dev 渲染 harness（VITE_DEV_TOOLS）。**真实浏览器冒烟通过**：隔离冒烟库 + media_sync 落盘真实 mp3 + 真实 headless Chrome——媒体端点 Range 206、loadedmetadata/seeking 事件、完整渲染管线截图；冒烟抓到并修复 root.tsx 缺 QueryClientProvider 的真实缺陷。headless 下 seeked/出声播放未完成确认（如实记录，留给有头浏览器/M2.3）。vitest 80 passed。
- **M2.2 Commit 4 作答持久化与反馈闭环（2026-11-16）**：练习固定 Release 恢复、服务端草稿 hydrate、800ms 自动保存与 `row_version` 冲突处理、最小 localStorage 待重试记录、整组未答确认/提交锁定、即时/统一反馈请求门控、完成/提前结束及结果页三态复盘已接通；修复恢复后自动保存漏绑 `sessionUnitId` 的真实缺陷。目标测试 6 passed；前端全量 97 passed；typecheck 与 production build（含 SCSS、SSG/SPA 产物检查）通过。测试进程仍有 happy-dom 卸载未完成 fetch 的 `ECONNREFUSED/AbortError` stderr 噪声，不影响退出码，后续测试基础设施清理。
- **M2.2 Commit 5 / M2.3 首轮端到端验收（2026-11-16）**：隔离库 `<DB>_e2e` + 合成 N2 形态卷（词汇单题/文法問題9 5 slot/读解 3 Unit/听力真实 mp3）走完整发布门槛；对真实 uvicorn 的 API 验收 36/36 + 版本阶段 6/6（刷新恢复、重复提交、skip≠wrong、end 模式封存、跨账号 404、新 release 不影响旧 session）；真实浏览器走通恢复→草稿→刷新恢复→未答确认→提交锁定→即时反馈→结果页、cloze 与听力渲染。联调发现并修复前端 DTO 缺陷（submit 内嵌 feedback 无 `feedback_mode`），新增回归测试；前端 98 passed，后端 103 passed + 2 skipped。**未完成**：真实 N2 题库、多浏览器/多视口、听力出声/拖动确认、SSG 部署验收、视觉走查（见 devlog）。
- **前端契约夹具（2026-11-16）**：18 份真实后端响应固化为夹具并由 vitest 用应用 DTO 解析（21 项契约测试）；立刻发现并修复 `/layers` 响应被误建模为数组的漂移。前端 119 passed，build 通过。错误响应与真实题库边缘形态未覆盖。
- **feedback 契约统一 + 目录页样式（2026-11-16）**：后端 submit 内嵌 feedback 与 GET 同形；补齐学习首页/试卷目录/大纲此前完全缺失的样式（`_catalog.scss`），顶栏 `首页` 不再在子路由高亮，加载错误区分「无法连接服务」。360px 无横向溢出、听力 dock 不遮挡提交按钮已实测；前端 121 passed、后端 103 passed + 2 skipped。Firefox/Safari、1024/768 逐档、200% 缩放、深色模式未测；品牌首页仍为占位。
- **N2 2018-12 真实内容 QA Agent 首轮（2026-11-16）**：由 claude-sonnet-5-5 对 59 个非听力 Unit（73 题）独立作答后同步入开发库：69 题 `agent_verified`，4 题（我首轮答错、看过答案键后独立性受损）`needs_review` 待人工；听力 30 题未校验。尚缺：听力校验、4 题人工确认、`rights_confirmed`、媒体同步；未发布任何真实内容（`exam_current_releases` 为空）。
- **N2 媒体同步（2026-11-16）**：`media_sync` 对真实 N2 同步 37 个资产（35 mp3 + 2 png）全部 stored，SHA-256/大小逐文件核对一致，重跑幂等；文件在 gitignored 的 `data/v2-media`。尚未发布，API 对真实内容仍无输出；真实文件的 Range 播放未复测。
- **N2 人工确认落地（2026-11-16）**：用户确认 4 道被标记题；新增 `apply_human_reviews`（draft release 上记 `human_reviewed`，不冒充 Agent）并让 promote 的 Unit 检查尊重后续人工确认；后端 106 passed。N2 开发库：69 agent_verified + 4 human_reviewed，仅剩听力 30 题未验证；仍缺 `rights_confirmed`，未发布。
- **N2 2018-12 非听力子集发布（2026-11-16，本机开发库）**：按用户指示发布 `JLPTGO-N2-2018-12-r4`（58 Unit/71 题，不含听力与問題12）；用户确认使用权，已记 `rights_confirmed`；67 题 agent_verified + 4 题 human_reviewed。真实 API 验证 58 个 Unit 无答案泄漏。发现审核哈希含 package_id 导致证据不随新包沿用（已重新同步，建议后续 ADR），并修复 `confirm-rights` CLI 缺 import。听力 30 题与問題12（A/B 切分待确认）待后续 release。仅本机，未部署。
- **真实 N2 浏览器走查 + 图片材料修复（2026-11-16）**：在真实后端/开发库走查已发布 r4：词汇、★排序、cloze、长读解渲染与真实解析正常；发现並修复图片材料只显示占位（問題14 价格表无法作答），现渲染真实图片并可点击放大。前端 123 passed，build 通过。遗留：会话级汇总文案易误读；手机宽度下密表图片可读性、全套 58 Unit 未走完。
- **管理员独立身份表（2026-11-16，ADR-0009）**：`admin_users`/`admin_sessions`（Alembic 0005，开发库已升级）、scrypt 口令、哈希存储的 12h 会话令牌、角色 viewer⊂reviewer⊂publisher、失败锁定、无 dev 旁路、命令行创建；13 个新测试（含一个测试抓到的锁定回滚 bug），后端 121 passed。**尚未创建任何管理员账号，也没有管理业务接口或 `apps/admin`**；既有命令行仍用自由文本审核人。
- **入库默认发布 + 仅超级管理员（2026-11-16，ADR-0010）**：`PUBLISH_POLICY=auto`（默认）下导入即发布，不再执行审核/版权门槛，且不把任何内容标成已验证（决策备注如实记录未验证项）；gated 路径与测试保留；管理员收窄为 `super_admin`（Alembic 0006）；已创建 `admin`，口令在被忽略的 `.local/`。后端 127 passed。管理端前端登录见后续条目。
- **管理端登录（2026-11-16）**：`apps/admin`（shadcn-admin v2.2.1，基线已入库）去掉 Clerk/演示页/外部字体，接入真实 FastAPI 登录；服务端校验的路由守卫、sessionStorage 令牌、退出即撤销会话；`THIRD_PARTY.md` 记录来源与改动。真实浏览器验证通过（重定向、错误/正确口令、刷新保持、退出后旧令牌 401）。admin 单测 20 passed，web 123 passed（修复了 vitest 4 引入的 jest-dom 绑定冲突），后端 127 passed。仅有登录与首页，无业务页；上游浏览器模式测试未跑。
- **全部试卷入库（2026-11-16）**：原始 106 套中 105 套转换、导入并自动发布到开发库（N1 32、N2 32、N3 28、N4 7、N5 6；学生可见 9,151 个 Unit，隐藏 74 个 needs_review）；4,027 个媒体全部同步；N3 2013-12 因源数据含 null 节点未入库。发现并修复 `get_engine()` 每请求新建连接池导致的连接泄漏（全量扫描时 149 个 500）与 m4a/webp 不被识别。全量 API 扫描 0 泄漏、0 错误；后端 134 passed。内容完全未校验（ADR-0010 已接受）。\n- **管理端试卷管理：下架/恢复上架（2026-11-16）**：`/api/admin/exams`、releases 列表、withdraw/restore 接口（需管理员会话，审核人由服务端写 `admin:<id>`，历史只追加）；管理端 `/exams` 页（搜索、级别/状态筛选、汇总、下架含原因、恢复）。真实浏览器在 105 套库上验证下架→公开目录 105→104、大纲/Unit 404→恢复回 105。后端 142 passed，admin 单测 31 passed。需重启后端才能使用新接口；未做批量下架与操作历史页。
- **视觉设计语言 v1.1（2026-11-16，纯文档）**：`design-system.md` 按用户稿件更新为「樱与墨 · Modern Minimal v1.1」：顶部导航改为居中胶囊容器（Active 浅樱底、无选中线；页面级 Tab 保持下划线）、色彩 Token 更名/调值（bg/surface/text-secondary/primary-hover 等）、新增首页布局/卡片/动效/无障碍/验收标准章节与 §13.1 基准 `:root` Token 清单（语义色沿用现有值保留）。P-003 备注同步。~~Token 对齐与胶囊导航实现待用户确认后另行执行~~（已于同日落地，见下条）。
- **学习首页 v1.1 落地（2026-11-16）**：`tokens.scss` 对齐 §13.1 基准（Token 更名/调值 + surface-subtle/shadow/motion/首页装饰色 token，三个 SCSS 文件引用同步）；顶导航改为品牌 + 居中胶囊（图标短标签、浅樱 Active、无通栏/选中线、窄屏横向滚动）；`/study` 首页重做：页头标题区、继续练习卡（release→试卷标题真实匹配）、四学科卡（诚实「暂未开放」）、历年试卷最新三套紧凑卡 + 查看全部。参考图中的等级选择器/铃铛/头像未实现（无真实账户数据，不造假）。vitest 125 passed、typecheck/build 通过、360–1440 四档实测无横向溢出；真实 uvicorn+开发库截图走查 `/study`、`/study/exams` 正常。继续练习卡真实会话视觉未走查（本地无 dev_test 用户配置）；Firefox/Safari/深色模式未测。
- **首页装饰改为固定渐变 + 导航去底色（2026-11-16）**：用户决定移除樱花装饰图（webp 已删），body 换为用户提供的三段径向渐变（#EEDCF6/#FFDFE6/#FEEFE8 → #FDF6F6，`background-attachment: fixed`）；sticky 头部去掉半透明底与 blur（与 fixed 渐变叠加出接缝），头部 pointer-events 穿透，胶囊导航白底保留。125 passed、build 通过、截图走查正常。风险：iOS Safari 不支持 fixed attachment；长页滚动时品牌文字会与内容叠字（待走查决定是否取消 sticky）。
- **学生账户体系完成（2026-11-16，ADR-0011）**：用户四项决策（邮箱登录、完整邮件流程、30 天 localStorage 会话、scrypt）。后端：Alembic 0007（users/user_sessions/auth_email_tokens，测试库与开发库已迁移）、共享 scrypt 抽取、register/login/logout/verify/resend/forgot/reset + GET/PATCH /api/me、统一 401 与 5 次锁定、Resend 邮件（无 key 走 dev 日志）、`get_current_user_id` 按约定替换（真实会话优先，dev_test 非生产兜底）；**后端 154 passed + 2 skipped**。前端：会话令牌存储、auth DTO/端点、authStore/useLevel 双轨、顶栏账户入口与等级选择器（**仅登录后显示**，用户决定）、5 个 noindex 认证页、ExamList 偏好种子（显式「全部」不被重种）；auth 专项 14 测试 + 种子回归；**前端 139 passed**、typecheck/build 通过。真实 Chrome 走查全流程通过（注册→验证→重放幂等→未验证拒绝→登录→等级 N1 持久→退出，服务端 DB 核验；后端临时移除真实 RESEND key，邮件走本地日志，未发真实邮件）。走查抓到并修复 3 个真实缺陷（StrictMode 双触发 verify、sticky 头部 pointer-events 恢复选择器旧类名、ExamList 空值被重种）。api-conventions 与 deployment 已同步。风险：无 IP 级限流（随部署硬化）；生产必须配置邮件三环境变量；React Router 默认 StrictMode 要求一次性 effect 防重触发。

- **真实发信联调（2026-11-16）**：修复 `backend/.env` 未加载、系统代理与缺 User-Agent 导致的 Resend 403；本机对用户自己邮箱发送一次测试邮件无报错（用户确认已收到）；后端 157 passed + 2 skipped。注册/找回密码真实邮件端到端与生产发信域名未验证。
- **本地 Docker 全栈（2026-11-16，ADR-0012）**：compose 增加 migrate/api/web，学生端 :8080、管理端 :8081（nginx 反代 /api，媒体只读挂载），冒烟通过：路由/noindex 规则、105 套目录、媒体 Range 206。未在容器内走浏览器全流程与管理端登录；非生产方案。
- **用户中心与头像（2026-11-16，ADR-0013）**：顶栏已登录显示等级选择器 + 头像（点击直达用户中心），首页历年试卷按等级筛选；`/study/account` 为 v1 式左右两栏，可编辑头像（沿用 v1 的 12 张固定头像，默认纯色首字头像）与昵称，备考等级移入此页；Alembic 0008；后端 162 passed + 2 skipped，web 155 passed；容器内真实浏览器桌面/375px 验证通过。无统计/收藏/改密码；非生产。
- **Select / Popover 组件规范与实现（2026-11-16）**：新增 `docs/design/select-spec.md`；自研 Select（Single/Grouped/Searchable，combobox + listbox，键盘与 ARIA，IME 保护）与 Popover（portal、无遮罩、避让视口、不被父容器裁剪、Esc 不穿透 Modal）；替换应用内全部 5 处原生 select；web 184 passed；dev 画廊与容器内真实页面目检通过。未测 Firefox/Safari/触屏/屏幕阅读器/深色模式。
- **学习端 UI 规范化一轮（2026-11-16/17）**：标题梯度 H1=38px…H6、吸顶头部胶囊（导航透明、过渡同步）、历年试卷改为年份分行的月份胶囊（标准高度 56px，无筛选，题数来自 `GET /api/exams` 新增的 `question_count`）、试卷详情页大题/练习组全部为标准胶囊并加纯文字面包屑「试卷 › 详情」、Select 去原生化与 Popover 规范、顶栏访客也可选等级。规范已同步到 `design-system.md`（§3.1 吸顶态、§3.6 面包屑、§6.5 胶囊、§7.2 标题）、`select-spec.md`、`page-structure.md`；web 207 passed、后端 162 passed + 2 skipped。未测：Firefox/Safari、深色模式、窄屏下多处细节、过渡动画观感；面包屑尚未用于练习/结果页。
- **Floating Audio Dock + Transcript Panel（2026-11-17，audio-player.md v1.1）**：练习页听力播放器重构为与内容等宽的底部悬浮卡片（80px、圆角 24、距底 20px，48px 深樱主按钮、±5s、倍速、音量 Popover、tabular-nums 时间、Ended 重播、buffering 防重复触发、error 重试）；新增向上展开的听力原文面板（fixed 不重排、独立滚动、视口自适应高度、Esc 收起、跟随播放可开关、当前 Cue 高亮为字体变深樱色（用户同日确认不用背景/指示线，aria-current 保留；曾因 `.transcript-scroll p` 直接规则压过继承导致只有时间标签变色，已收窄作用域修复）、点击有效 Cue 定位播放、无效时间戳降级为不可点击文本；段落不显示时间数值、上下间距收紧、Dock 宽屏比内容容器窄 100px（均为用户同日调整）；后续 UI 优化轮（同日）：面板与播放器合并为单一浮动组件（统一阴影/圆角/分割线，展开向上生长不改变页面高度）、面板默认 300px/最大 360px/正文阅读宽度 800px 居中、Active 段落恢复浅樱背景（覆盖早前仅变色方案）、排版按规范（标题 18px/正文 16px/行高 1.8/段距 12px）、跟随播放改 Token 风格 Switch、顶部工具栏「听力原文—Switch—Chevron 收起」；追加：中文对照开关（原始数据 translation 段落经 transcript 端点同门控按序配对，数量不齐不猜）、移除「已保存」徽标与「清除本题选择」按钮、底部正圆角修复、去 scroll 最大宽度；
- **Quick Practice 快速练习（2026-11-17，quick-practice.md v1.0）**：试卷详情 Unit 行改整行可点（标题/题数/✓已练/Chevron），移除反馈方式下拉与行内开始按钮；点击直查活跃会话——含该 Unit 则恢复、否则创建 immediate 单 Unit 会话，活跃冲突弹一次三操作对话框（取消/继续旧练习/开始新练习），开始新练习走后端 `replace_active=true` 原子替换（同事务 ended_early+建新，部分唯一索引兜底并发，5 项新测试覆盖幂等与数据保留）；新增 `GET /api/exams/{id}/practice-status` 本人 per-unit 提交历史；答题页全答直提不弹窗、未答一次确认（新文案）、提交后就地「下一组/返回试卷」导航。规范入库 `docs/design/quick-practice.md`。后端 174 passed + 2 skipped，web 224 passed，typecheck/build 通过；容器重建冒烟通过（发现 api 镜像由 migrate 服务构建，需 build migrate）。真实浏览器端到端待用户实测；practice-status 查询未做索引评估。cues 经 `GET .../transcript` 与 feedback 完全同门控下发（immediate 提交后/end 交卷后），公开 unit 端点仍恒不携带 cues，前端经 RichText 白名单渲染；规范入库 `docs/design/audio-player.md` 并挂接 README/practice-interactions。后端 167 passed + 2 skipped（新增 transcript 门控 5 测试），web 223 passed（AudioDock 19 测试）、typecheck/build 通过；Docker 全栈重建冒烟通过（/api/exams 105 套、未鉴权 401、迁移正常）。真实浏览器视觉走查未执行（交用户 :8080 实测）；Firefox/Safari、深色模式未测。
- **Quick Practice 轻量化（2026-11-17，quick-practice.md v2.0 + ADR-0014）**：新增独立 `quick_practice` 会话模式（Alembic 0009：mode CHECK 扩展 + `ux_one_active_quick`，专项/模考单活跃索引不变）——点 Unit 直建 quick 会话进入，**无任何冲突弹窗**；quick 会话之间静默替换（同事务 ended_early+建新，绝不触碰专项会话）；无服务端草稿/恢复（`useDraftManager` persist 开关，选择纯本地、刷新/离开重置；`study_answer_drafts` 表保留给专项）；提交即完成（同事务 completed + `study_results`，`_complete_session` 与 finish 共用）；`practice-status` 双模式真实计数，目录「未练习/已练习 N 次」+ Layer「已练习 X / Y 组」（去 ✓ 对勾）；提交后「下一组」=同卷下一 Unit 开新会话。后端新增 quick-practice 测试 5 项（含专项会话不受 quick 影响的核心隔离），**179 passed + 2 skipped**；web 重写 ExamOutline 用例 + 新增 PracticePage quick 用例 5 项，**229 passed**，typecheck/build 通过；开发库迁移 upgrade/downgrade/upgrade 真实验证通过。真实浏览器端到端、听力 quick 练习走查、Firefox/Safari/深色模式未测；practice-status 索引评估沿袭未做。
- **Quick Practice 文案动态化 + 按钮样式补齐（2026-11-17，quick-practice.md v2.1）**：文案按 Canonical Unit 类型映射（独立单题=提交答案/下一题、文法多题组=提交本组/下一组、阅读文章=提交本篇/下一篇）；标题用大纲真实位置（問題1-3）；多题 Unit 组内「上一题/下一题」分页（纯展示，整组提交事务不变）；单 Unit 不再显示「第1/1组」与「已提交锁定」（专项练习保留）；Layer 头部简化为「已练习X/Y」数字主色高亮；按钮样式补齐（practice/dialog/post-submit 次级描边胶囊、原文面板重试、分页器）；web **230 passed**、typecheck/build 通过。真实浏览器走查与 Firefox/Safari/深色模式未测。
## 后续工作（2026-11-18 审查调整）

1. 修复草稿可靠性与 practice/mock 接口模式边界，补回归用例并完成真实 PG 验证。
2. 模考成绩逐题回顾与历史入口已实现（ADR-0027），待真实浏览器验收。
3. 完成真实题库、跨浏览器、慢网/断网恢复与听力、响应式端到端验收。
4. 对外测试前完成认证/邮件限流、真实邮件、备份恢复、媒体与部署检查；生产操作单独授权。
5. 内容质量与发布快照 DB 权限继续跟进；收藏/趋势/AI 等不默认纳入本阶段。

详细发现、复现条件、验收建议及未执行检查见本次审查日志。下方历史条目的“未做”只描述当时状态。

## 已知缺口 / 风险

- 未配置 ruff/mypy 等静态检查工具。
- 发布快照表无 DB 级不可变约束，靠应用纪律；restricted role 上线前必须补。
- Layer/Section 关联等 4 处真实数据包与 canonical-schema 草案不一致（见 2026-11-15 importer 日志），文档待修订。
- 转换器 `SELECTIONS` 硬编码；转换其余约 130 套归档前需改为按 `exams.json` 选择。
- `content_reviews.sequence` 在极端并发插入下按分配序入库（单进程 CLI 场景无影响）；多人并发审核工具上线前需评估。

- **次级按钮内边距修正（2026-11-17）**：`_practice.scss` 引用了不存在的 `--space-5` 致 padding 失效，改为 `--space-4`；前端 230 passed、build 通过，浏览器视觉复核待用户。

- **答对选项变绿 / 已练习次数高亮 / 中文字体栈（2026-11-17）**：见 `docs/devlog/2026-11-17-correct-option-green-unit-count-fonts.md`；日文内容 `lang="ja"`，页面中文优先字体栈。浏览器视觉待用户确认。

- **首页继续练习卡片去掉 continue-meta（2026-11-17）**：见 `docs/devlog/2026-11-17-remove-continue-meta.md`；web 231 passed、typecheck/build 通过，web 容器已重建。浏览器视觉待用户确认。

- **首页移除历年试卷模块（2026-11-17）**：见 `docs/devlog/2026-11-17-remove-home-exam-entry.md`；web 225 passed、typecheck/build 通过，web 容器已重建。浏览器视觉待用户确认。

- **专项练习首版闭环（2026-11-17）**：见 `docs/devlog/2026-11-17-topic-practice.md`。后端新增题型目录与服务端智能抽样接口（复用 practice 会话事务），前端新增 `/study/practice` 配置页、顶栏/首页入口、结果页「再练一组」；后端 195 passed + 2 skipped，web 237 passed，typecheck/build 通过，容器已重建，真实开发库只读冒烟通过。真实浏览器验收、`user_question_progress` 缓存、「只复习最近仍错」、Firefox/Safari/深色模式未做。

- **（已被 ADR-0016 取代）取消专项/普通练习单活跃限制（2026-11-17，ADR-0015）**：见 `docs/devlog/2026-11-17-multi-active-sessions.md`。Alembic 0010 删除 `ux_one_active_practice`（Quick/模考单名额不变），创建练习不再检查/结束/覆盖其他会话，无 409 与 `replace_active`，前端删除冲突弹窗与 `ActiveSessionConflictDialog`；`/current` 改为最近进行中练习。后端 197 passed + 2 skipped，web 通过，开发库迁移 up/down/up 通过。真实浏览器验收、进行中练习列表入口未做。

- **专项练习统一反馈整次提交（2026-11-17）**：见 `docs/devlog/2026-11-17-unified-feedback-final-submit.md`。统一反馈会话导航只存草稿，整次通过 `POST /api/practice/sessions/{id}/submit` 一次性事务判题并生成结果（幂等、非法答案整体回滚），逐 Unit 提交接口对该模式拒绝（409）；前端新增连续题目流（上一题/下一题/题号导航，最后一题确认一次）。后端 203 passed + 2 skipped，web 244 passed，typecheck 通过。真实浏览器验收未做。

- **专项练习单一最近进度（2026-11-17，ADR-0016，取代 ADR-0015）**：见 `docs/devlog/2026-11-17-single-recent-session.md`。Alembic 0011 恢复 `ux_one_active_practice`，创建专项/普通练习时同事务把旧进行中会话置 `abandoned` 再创建（失败整体回滚、并发后来者胜、已提交答案与历史保留、未提交草稿不计）；`/current` 即唯一可恢复练习，完成后保存结果；不做多练习列表/清理；Quick/模考不变。后端 205 passed + 2 skipped，web 246 passed，typecheck 通过，迁移 up/down/up（含多会话数据升级）已验证。真实浏览器验收未做。

- **user_question_progress 缓存 + 专项「只复习最近仍错」（2026-11-17）**：见 `docs/devlog/2026-11-17-question-progress-wrong-only.md`。每题缓存在每次正式提交的同一事务内重算（skip 不覆盖最近正误，可由 `rebuild_user_progress` 整体重建），迁移 0012 回填历史（开发库 up/down/up 通过）；专项目录新增 `wrong_units`、创建接口新增 `selection=wrong_only`，配置页与「再练一组」接通。后端 212 passed + 2 skipped，web 257 passed，typecheck/build 通过。真实浏览器验收、容器重建、缓存性能评估未做；错题本/学习历史/统计与严格模拟规则文档尚未开始。

- **严格模拟规则草案（2026-11-17，纯文档）**：新增 `docs/product/mock-exam-rules-draft.md`（待确认，非产品规则）。核查发现：Phase/时限表已建但**真实库 `release_exam_phases` 为 0 行**，转换器不产出 Phase，模考无任何接口/前端，practice 提交对 mock 返回 409。列出 M1–M10 待用户决定项（各级别 Phase 时限、听力播放、超时封存、Phase 间规则、成绩呈现、名额、答案泄漏边界）与确认后的实施顺序；未改代码，未新增 ADR（确认后再写）。

- **严格模拟规则确认（2026-11-17，ADR-0019，纯文档）**：用户逐条确认 M1–M10（M8 改为练习/模考互相直接替换、无确认）；各级别 Phase 时限取自 JLPT 官网并写入 ADR；回填决策表 P-023、business-rules、feature-scope、page-structure。见 `docs/devlog/2026-11-17-mock-exam-rules-adr.md`。**规则已定、实现未开始**（真实库无 Phase 数据；单进程约束需迁移）；未改代码。

- **严格模拟 Phase 数据层（2026-11-17，ADR-0019 首步）**：见 `docs/devlog/2026-11-17-mock-exam-phase-data.md`。Canonical 新增可选 `phases.jsonl`（计入内容哈希，缺省包哈希不变），转换器按官方规则表生成（N1/N2 两个、N3–N5 三个 Phase；缺科目则不生成），导入校验与发布写入 `release_exam_phases`/`release_phase_units`。后端 235 passed + 2 skipped；N2 2018-12 在临时库验证 88 个 Unit 全覆盖。已按用户授权全量重新转换并导入本机开发库：105 套 current release 均带 Phase（N1/N2 各 2 个，N3–N5 各 3 个），每个 Unit 恰属一个 Phase，内容文件与旧包零差异；已 pg_dump 备份。模考会话/计时/接口/前端未开始，尚无用户可见变化。

- **我的学习：学习概览/练习历史/题目记录（2026-11-17）**：见 `docs/devlog/2026-11-17-learning-stats.md`。新增 `/api/me/learning/{overview,history,questions}`（正式作答口径、skip 不入分母、覆盖率、薄弱题型 ≥5 次样本、错题策略 B）与 `/study/learning` 三 tab 页、顶栏「学习」入口。后端 243 passed + 2 skipped，web 266 passed，typecheck/build 通过，容器重建并用真实数据在浏览器核对文本。**视觉走查未做**（浏览器窗格隐藏）；收藏、统计时间范围、趋势、阈值待产品确认。
- **我的学习走查调整（2026-11-17）**：按用户反馈加入页码分页（每页 10 条、含总数，通用 `Pagination` 组件）并按设计系统既有 token 补色（指标卡/学科标签/进度条/结果胶囊）。web 272 passed，build 通过，容器已重建；视觉与分页条未在浏览器中亲眼核对（窗格隐藏），待用户目检。见 `docs/devlog/2026-11-17-learning-stats.md`。
- **我的学习页面优化（2026-11-18）**：见 `docs/devlog/2026-11-18-learning-page-optimization.md`。薄弱题型仅列明显偏低者（最多 3、小样本标「数据较少」）并可直达题型；新增「建议先复习 · N 道最近仍错」；按科目整行进入专项；练习历史整行可点；题目记录「重新练习」。后端 243 passed + 2 skipped，web 275 passed，typecheck/build 通过。真实浏览器视觉走查、容器重建未做；完整模拟来源待模考上线。

- **严格模拟后端（2026-11-18，ADR-0019 第 1 步）**：见 `docs/devlog/2026-11-18-mock-exam-backend.md`。迁移 0013（练习/模考共用单名额）、`/api/mock-exams`（Phase 状态机、服务器计时、惰性到期封存、无答案内容接口、交 Phase 幂等、结果仅完成后开放）。后端 252 passed + 2 skipped，迁移测试库 up/down/up 通过。开发库未迁移；前端、严格听力播放器、浏览器验收未开始，对用户尚无可见变化。
- **模考独立名额（2026-11-18，ADR-0020，取代 ADR-0019 M8）**：Alembic 0014 恢复练习/模考各自单名额，互不放弃；已有模考时再开始需继续或 `replace_active`。后端 253 passed + 2 skipped。前端仍待做（含「模考进行中」提示）。
- **严格模拟前端：说明页与考试页（2026-11-18）**：见 `docs/devlog/2026-11-18-mock-exam-frontend.md`、`docs/design/mock-exam-ui.md`。统一考试框架（Sticky 状态栏 + 覆盖式答题卡）+ 一屏多题/文章双栏布局、阶段交卷确认、最小成绩页、「模考进行中」提醒、说明页；后端新增 `/content`；nginx 增加 `/mock` 回退。后端 253 passed + 2 skipped，web 289 passed，typecheck/build 通过；真实库 45/105 套可模考，N2 2012-12 全流程（含到期封存）走通。视觉走查未做；严格听力播放器、成绩逐题回顾未做。
- **严格模拟：听力播放器（2026-11-18）**：见 `docs/devlog/2026-11-18-mock-exam-listening.md`。音频按服务器时间线只播一次（Alembic 0015 记录开始时间，刷新只能续播，播完永久消耗），无暂停/拖动/倍速/重播控件。后端 255 passed + 2 skipped，web 296 passed，typecheck/build 通过；真实库 N2 听力阶段在浏览器内验证了真实播放、暂停恢复、拖动还原、刷新续播。视觉走查、听感确认、音频可用性开放条件、成绩页听力原文未做。
- **模拟考试 UI 优化与倒计时修复（2026-11-18）**：见 `docs/devlog/2026-11-18-mock-exam-ui-polish.md`。倒计时冻结的根因（每次渲染重算时钟偏差）已修复并加假时钟测试；胶囊 Header、紧凑连续作答、答题卡 Drawer 重做、当前题滚动监听定位。web 302 passed，typecheck/build 通过，真实页面计算样式与倒计时已核对；视觉走查未做。
- **模考共享材料题统一布局（2026-11-18，ADR-0021）**：见 `docs/devlog/2026-11-18-mock-shared-material-layout.md`。按材料结构分 standalone/shared-material/cloze（纯图片信息检索也双栏 62/38），去掉按题型名的 flow；多题 Unit 放得下全显示、放不下才逐题切换（题号显示已答/标记）；选项按字数单列或 2×2；图片页内放大；答题卡跳转定位到 Unit 并切题。web 309 passed，typecheck/build 通过；Docker 真实页面在 1440×900/1440×1300/900 宽核对問題10–14 布局与跳转。仅模考页；视觉人工走查、其他浏览器未做；图片尺寸未入库。
- **模考听力连续播放（2026-11-18，ADR-0022）**：见 `docs/devlog/2026-11-18-mock-continuous-listening.md`。有完整录音的听力阶段整段连续播放（服务器单一时间线、只播一次，迁移 0016 + 阶段级 start 接口，片段不再下发）；确认页确认即自动播放；底部短胶囊 Mini Player 只有播放按钮与进度条；暂停/拖动/倍速在播放器逻辑层复位。后端 257 passed + 2 skipped，web 315 passed，typecheck/build 通过，开发库已迁移；Docker 真实页面验证确认页、自动播放、刷新续播与服务端位置一致。Safari/Firefox、确认页期间是否暂停计时未定。
- **模考「一份材料一页」（2026-11-18，ADR-0023）**：见 `docs/devlog/2026-11-18-mock-one-material-per-page.md`。共享材料大题一页一个 Unit（上一篇/下一篇），多题 Unit 右栏恒为一次一题（上一题/下一题，末题换「下一篇」），取代 ADR-0021「放得下全显示」。web 316 passed，typecheck/build 通过。**未做真实浏览器走查**（問題9–14、Slot 联动、Sticky 视觉待验）。
- **模考验收修复（2026-11-18，ADR-0024）**：见 `docs/devlog/2026-11-18-mock-acceptance-fixes.md`。听力确认后才开始倒计时（确认页不走时）；说明页与考试页顶栏均可「放弃考试」（新接口 `/abandon`，不再「放弃并重新开始」）；图片查看器遮罩覆盖全屏；题卡去背景高亮。后端模考测试 16 passed，web 317 passed，typecheck/build 通过；浏览器视觉待用户复核。

- **界面文案精简（2026-11-18）**：见 `docs/devlog/2026-11-18-copy-cleanup.md`。专项练习答题页标题仅「专项练习」，去掉反馈模式说明与「组」计数，精简配置页/模考说明页文案。web 335 passed、typecheck 通过；全站文案逐页审校与浏览器复核未做。
- **管理端中文字体（2026-11-18）**：见 `docs/devlog/2026-11-18-admin-cjk-font.md`。字体栈补中文回退（苹方/雅黑/Noto 等），tsc、build 通过；浏览器视觉未复核。
