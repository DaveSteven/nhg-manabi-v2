# 项目总体进度

最后更新：2026-11-16

## 已完成

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

## 进行中（当前开发阶段）

- **M2 核心学习流程**（计划见 `docs/development/M2-core-learning-flow.md`）：FastAPI 作答引擎 → React 学习页面 → 端到端验收。**M2.1 全部完成（Task 01–08）**；M2.2 进行中：**Commit A、1、2、3 已完成**，下一步 Commit 4（作答持久化与反馈闭环）。
- **M2.2 前端实施准备（2026-11-16）**：新增 `docs/development/M2.2-frontend-implementation.md`，已明确 React Router Framework Mode SSG+SPA、学习首页、试卷目录、Canonical Unit/RichText/听力渲染、草稿与提交反馈、自动恢复及测试验收。
- **M2.2 Commit A 媒体前置（2026-11-16）**：Alembic `0004` `media_storage` 映射表；`python -m app.media_sync` 独立同步步骤（SHA-256 内容寻址、校验后原子落盘、幂等/自修复/失败诊断）；`GET /api/releases/{rid}/assets/{aid}` 四重门槛公开媒体接口（统一 404、RFC 9110 Range、历史 release 可读）；迁移升级/回滚验证通过；回归 103 passed + 2 skipped（环境性 skip）。接口契约已写入 M2.2 计划 §6/§8；真实样本同步与浏览器冒烟待执行。
- **M2.2 Commit 1 前端脚手架（2026-11-16）**：pnpm workspace + `apps/web`（React Router 7 Framework Mode，`ssr:false` + `prerender:["/"]`，`entry.server.tsx` 仅构建期 prerender 用，无运行时 Node SSR）；樱与墨 tokens 与全局样式；四项顶导航（未实现入口「暂未开放」）；API adapter（zod strictObject DTO，拒绝 cues/答案字段泄漏；三种后端错误形状归一化；dev_test token）；Vite dev proxy `/api`→8001（不加 CORS）；构建验收脚本（预渲染品牌 HTML、noindex SPA fallback、凭据泄漏扫描）。typecheck 通过；vitest 37 passed；`pnpm build` 含产物检查通过。品牌页为最小占位，真实文案待设计输入。
- **Claude 项目开发入口与分支流程（2026-11-16）**：根目录 `CLAUDE.md` 与 `.claude/skills/nhg-manabi-development/SKILL.md` 强制 Claude Code 先读取 `AGENTS.md`，再执行文档路由、工作树保护、测试真实性与收尾要求；日常开发/提交统一使用 `develop`，`main` 仅记录成功上线状态，只有上线验收完成并获用户明确确认后才合并。
- **M2.2 Commit 2 学习首页与试卷目录（2026-11-16）**：`features/catalog`（学习首页四学科入口+继续练习卡片+并行请求独立状态；试卷列表 URL 筛选；下划线 Tab/Layer 展开/Unit 列表）、`features/practice` 409 活跃会话冲突对话框（继续/结束旧练习，ended_early 语义显式确认）；MSW 集成测试 14 例。vitest 51 passed。实现期发现 jsdom 与 Node undici 的 AbortSignal realm 冲突会使 react-router 数据路由全部导航静默失败，vitest 环境改用 happy-dom（记录于 devlog）。真实后端走查合并至 Commit 4。

- **M2.2 Commit 3 Canonical 渲染器（2026-11-16）**：RichText v1 白名单安全渲染（零 dangerouslySetInnerHTML、未知节点安全降级、slot 对 unit.slot_ids 完整性校验）、中性 view model（printed_number 透传、prompt=null 合法）、A/B 双文与衬线阅读排版、固定底部音频 dock（播放/拖动/缓冲/失败态，safe-area 预留）、dev 渲染 harness（VITE_DEV_TOOLS）。**真实浏览器冒烟通过**：隔离冒烟库 + media_sync 落盘真实 mp3 + 真实 headless Chrome——媒体端点 Range 206、loadedmetadata/seeking 事件、完整渲染管线截图；冒烟抓到并修复 root.tsx 缺 QueryClientProvider 的真实缺陷。headless 下 seeked/出声播放未完成确认（如实记录，留给有头浏览器/M2.3）。vitest 80 passed。
## 未开始（按依赖顺序）

1. M2.2 Commit 2–4：学习首页/试卷目录 → Canonical 渲染器（含音频）→ 作答闭环与反馈（实施计划、ADR-0007、后端契约与媒体接口均已就绪）。
2. 管理端安全引入与首条纵向流程（ADR-0008；固定上游版本 → 移除 Clerk/演示内容 → Import Job 列表/详情；不阻塞当前 M2.2）。
3. 运行真实 Agent 校验（按 contract 批量产出五套题库结果 → sync → 解锁 promote）；N4 4 个确证字幕越界待人工重对时间轴（当前为 open blocking，阻止 N4 发布）。
4. N5/N3/N2/N1 逐包执行 `python -m app.data_quality sync`（M1.6 机制已就绪，按任务要求未自动全量跑）。
5. 发布快照不可变的 DB 触发器 / restricted DB role。
6. 认证/用户体系（当前内部 API 仅共享令牌；M2 Task 03 仅做最小身份边界）。

## 已知缺口 / 风险

- 未配置 ruff/mypy 等静态检查工具。
- 发布快照表无 DB 级不可变约束，靠应用纪律；restricted role 上线前必须补。
- Layer/Section 关联等 4 处真实数据包与 canonical-schema 草案不一致（见 2026-11-15 importer 日志），文档待修订。
- 转换器 `SELECTIONS` 硬编码；转换其余约 130 套归档前需改为按 `exams.json` 选择。
- `content_reviews.sequence` 在极端并发插入下按分配序入库（单进程 CLI 场景无影响）；多人并发审核工具上线前需评估。
