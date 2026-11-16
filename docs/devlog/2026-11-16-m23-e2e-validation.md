# 2026-11-16 · M2.3 / M2.2 Commit 5：隔离库端到端验收（首轮）

## 范围

按 `M2-core-learning-flow.md` §四 与 `M2.2-frontend-implementation.md` §10.2，在**隔离测试库**中用**合成 N2 形态内容**（非真实题库，未经审核的真实内容未公开）走通真实 FastAPI + 真实 PostgreSQL + 真实浏览器的学习闭环。不是 M2 完成声明：多浏览器/多视口走查、SSG 部署验收仍未做。

## 改动

- `scripts/e2e_seed_n2.py`：建隔离库 `<DB>_e2e`（alembic 全量迁移），合成 N2 形态卷（文字词汇单题 1 Unit；文法問題9 = 1 cloze Unit/5 Question/5 slot；读解問題11 = 3 个独立 passage Unit；听力 = 1 个 audio Unit，真实 1s mp3 + 2 条 cue），走完整发布门槛（stage→publish→human_reviewed→rights→promote）。`--revision 2` 产出内容变更的第二个 release，用于版本隔离验证。仅测试库内把答案键标 human_reviewed，不触碰开发库。
- `scripts/e2e_api_check.py`：对真实 uvicorn 进程的 stdlib HTTP 验收（36 项 + 版本阶段 6 项）。
- **缺陷修复（浏览器联调发现）**：`FeedbackPayloadSchema`（strictObject）要求 `feedback_mode`，但后端 **submit 响应内嵌的 feedback 不含该字段**，而独立 `GET /feedback` 含该字段。前端因 DTO 校验失败，导致"提交成功但页面显示提交失败"（服务端已入库、刷新后锁定）。改为 `feedback_mode` 可选（该字段前端无处读取，权威值在 session 上）。原 MSW mock 手写了该字段，所以 97 个单测没能发现——正是联调的价值。新增 1 条回归测试，PracticePage/DTO mock 去掉虚构字段。

## 实际执行与结果

| 检查 | 结果 |
|---|---|
| `e2e_api_check.py` 主阶段（对真实服务器） | 36/36 通过 |
| `e2e_api_check.py --phase release2`（发布 rev2 后） | 6/6 通过 |
| `pnpm -F web typecheck` | 通过 |
| `pnpm -F web test` | 98 passed（97 + 1 回归） |
| `pnpm -F web build`（含 check-build） | 通过 |
| 后端 `pytest` 全量（真实 PG） | 103 passed, 2 skipped（skip 为缺本地 Canonical Archive.zip，环境性，与本次无关） |
| 真实浏览器（内置浏览器 + Vite dev + 真实 uvicorn） | 见下 |

API 层覆盖场景：文法 1 Unit/5 Question/slot 1:1；读解三个独立 Unit；公开载荷零答案/解析字段；听力载荷不暴露 cues；媒体 Range 206；单活跃练习 409；刷新后会话与草稿恢复；跨账号 session/drafts/results/feedback/submit/draft 写入全部 404、匿名 401；重复提交幂等；未提交 Unit 不给反馈；end 模式提交响应无正误且反馈封存至结束；全部提交→completed 且 correct+wrong+skipped=total，5 个整组未答计为 skipped；有未提交→ended_early 返回 409 `no_results_early_end`；发布 rev2 后进行中 session 仍绑定旧 release、旧 release 单元仍可读、对已被取代 release 新建 session 被拒（422）、新 release 内容含"改訂"而旧的不含。

浏览器层覆盖：学习首页"继续练习"卡片 → 恢复页；选项 → 800ms 自动保存"已保存"；**硬刷新后草稿恢复**；整组含未答提交弹出确认并说明"未答与错误答案区分"；已提交组锁定（刷新后仍锁）；即时反馈显示"✗ 错误"与"— 未答"（并给出解析）；完成练习 → 结果页 0/1/5/6 与逐题复盘；文法 cloze 5 个 slot（46–50）渲染并与题目绑定；听力 Unit 底部 dock 加载真实 mp3（readyState 4，时长 1s，0:00/0:01）。

## 未执行 / 未覆盖（如实）

- 真实 N2 题库未验收：本轮全为合成内容；真实包未过发布门槛（Agent 校验未批量运行，N4 有 open blocking）。
- 浏览器：仅内置浏览器（Chromium 系）单一视口；Chrome/Firefox/Safari 及 1440/1024/768/390/360px 走查**未做**。
- 听力：未确认出声播放与拖动后 seeked（无输出设备/自动化限制）；字幕按"已确认权限"显示的规则未实现，cues 仍不公开。
- 浏览器内仅手动走了读解（部分）、文法与听力渲染；vocab 单题、end 模式、跨账号、重复提交、版本更新仅在 API 层验证，未在浏览器内逐项点击。
- 浏览器内一次"确认提交"点击因滚动后坐标偏移未命中（工具操作问题，非产品缺陷），改用 API 完成剩余两组提交。
- SSG/SPA 部署验收（静态宿主路由、404、noindex 实机）、视觉走查未做。
- 观察到：练习页顶栏高亮"首页"而非"我的学习"（页面标题为"我的学习"），未处理，待设计确认。

## 剩余风险

- 前端 DTO 为 strictObject，任何后端新增/缺失字段都会让整页失败；本次缺陷即此类。建议后续把真实后端响应样例（由 e2e_api_check 抓取）固化为契约测试夹具，替代手写 MSW mock。
- 后端 submit 内嵌 feedback 与 GET feedback 载荷不一致（feedback_mode），应在后端统一（本次仅前端容忍）。
- `e2e_seed_n2.py` 复用 `backend/tests` 的 fixture 构造器并对其 `build_manifest` 打补丁，属测试辅助脚本，非生产代码。
