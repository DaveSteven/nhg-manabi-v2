# Devlog · Quick Practice 轻量化（独立会话模式、无草稿、提交即完成）

日期：2026-11-17 · 分支：develop · ADR-0014 · quick-practice.md v2.0

## 任务范围

按用户 2026-11-17 指示，把历年试卷单 Unit Quick Practice 从「复用专项练习会话模型
（单活跃 409 + 冲突弹窗 + 服务端草稿 + 刷新恢复）」轻量化为「随点随练」：
移除草稿、恢复与会话冲突流程，保留正式提交历史与全部服务端判题/答案权限机制。

## 改动内容

### 数据库（Alembic 0009，纯约束，无表/列变化）

- `study_sessions.mode` CHECK 扩展 `'quick_practice'`；mode/`mock_release_id` 一致性 CHECK
  同步（quick 会话 `mock_release_id IS NULL`）。
- 新增部分唯一索引 `ux_one_active_quick`（每用户至多一个进行中 quick 会话）。
- `ux_one_active_practice` / `ux_one_active_mock` 不变 → quick 与专项/模考会话彻底互不影响。
- 开发库真实验证：upgrade → 检查约束/索引 → downgrade 0008 → 再 upgrade head，全部通过。

### 后端 `app/api/practice.py`

- 新增 `POST /api/quick-practice/sessions`：单 Unit、固定 immediate；同事务静默结束旧的
  进行中 **quick** 会话（ended_early）后建新会话；Unit 可用性门槛与 practice 会话相同
  （current published release + conversion complete）；并发双击 409（`ux_one_active_quick` 兜底）。
- `_require_active_practice` 与 submit 内的会话检查接受 `practice`/`quick_practice` 两种模式
  （mock 仍 409）。
- 提交自动完成：quick 会话正式提交的同一事务内 `completed` + `study_results`
  （抽出 `_complete_session` 与 finish 端点共用）；submit 响应新增 `session_state` 字段；
  幂等重复提交（already=true）不重复完成/判题。
- `GET /api/exams/{id}/practice-status` 统计口径扩展为 `mode IN ('practice','quick_practice')`
  （两种模式都是该 Unit 的真实正式练习）。

### 前端 `apps/web`

- `ExamOutline.tsx` 重写：点 Unit → `POST /api/quick-practice/sessions` → 直接进入
  （删除活跃会话探测、「继续旧练习？」三操作弹窗、`replace_active` 路径）；409 自动重试一次。
  Unit 行显示服务端计算的「未练习 / 已练习 1 次 / 已练习 N 次」（去掉 ✓ 对勾）；
  Layer 头部显示「已练习 X / Y 组」。
- `PracticePage.tsx` quick 分支：选择纯本地状态（`useDraftManager` 新增 `persist` 开关，
  persist=false 时零 PUT /drafts 流量）；无草稿 hydrate、无 pending retries、无版本冲突弹窗；
  提交后就地反馈，已完成会话回访时已提交选择经 feedback 载荷回显（唯一合法来源）；
  提交后导航「下一组」（同卷按 outline 顺序的下一个 Unit，开新 quick 会话；最后一组不显示）
  /「返回试卷」；被替换的旧会话页显示「本次练习已被新的练习取代」+「重新练习本组」。
- DTO：`mode` 改为 enum(`practice`,`quick_practice`)；`SubmitResult.session_state` 可选字段。
- `useStartPractice.ts` 新增共享 `useQuickPracticeStart`（目录页与答题页下一组/重新练习共用）；
  既有 `useStartPractice`（专项练习建会话）保留未动。

### 文档

- `docs/design/quick-practice.md` v2.0：替换会话模型（§3 静默替换/提交即完成）、草稿（§4 无服务端
  草稿）、目录计数（§5）、Modal 原则（§8 无任何冲突弹窗）。
- `docs/decisions/ADR-0014-quick-practice-lightweight-mode.md`（新增）；
  `docs/decisions/README.md` 增加 P-022 行与 ADR 导航。

## 实际执行的测试与结果

后端（真实 PG，`DATABASE_URL` 指向本机 Docker 测试库）：

- `tests/test_quick_practice.py` 新增 5 个测试（共 10 个，全部通过）：quick 会话独立模式创建、
  **进行中专项会话 + quick 创建互不影响（核心隔离）**、quick 之间静默替换且无提交数据损失、
  提交自动完成（completed + study_results 判分 1 对 1 错、feedback 随响应下发、finish 幂等）、
  练习计数（未答提交计 1、完成后重复提交 409 不加计数、专项再提交同 Unit 计 2）。
- 全量后端回归：**179 passed + 2 skipped**（此前 174+2；skip 为环境性 Canonical Archive.zip 缺失）。
- 迁移一致性（metadata vs 0001 DDL）与 Schema 编译测试通过；0009 为纯 SQL 迁移，未动
  `app/db/schema.py`（沿用 0002+ 的既定模式）。

前端（vitest + happy-dom + MSW）：

- `ExamOutline.test.tsx` 重写 quick 相关用例（7 passed）：直点创建 quick 会话（请求体仅
  release_id/unit_id）、已有会话时仍开新练习且零弹窗、服务端练习次数渲染（已练习 2 次/未练习/
  Layer 已练习 1 / 1 组 / 已练习 0 / 1 组）、创建失败 alert 无弹窗。
- `PracticePage.test.tsx` 新增 5 个 quick 用例（文件共 12 passed）：选择零草稿请求（等待超过去抖
  间隔）、全答直提无确认 + 反馈/解析 + 下一组/返回试卷、下一组开新 quick 会话（请求体 =
  同卷下一 Unit）并导航、未答保留一次确认、已完成会话回显已提交选择且无草稿请求。
- 全量前端：**229 passed**（此前 224）；`tsc --noEmit` 通过；`pnpm build` 通过（含 SSG/SPA
  产物与凭据泄漏检查）。

其他：`git diff --check` 通过（提交前复检）。

## 未执行 / 待验证

- 真实浏览器端到端（含听力 quick 练习、AudioDock + transcript 门控在 quick 会话下的表现）
  未执行——本地走查可由用户在 :8080 容器环境实测；容器镜像需重建（api 镜像由 migrate 服务构建）。
- 并发双击的真实竞态只由后端测试的顺序请求覆盖，未做真正的并行压测。
- Firefox/Safari、深色模式、窄屏下的 Layer/Unit 行换行观感未走查。

## 剩余风险

- `practice-status` 仍按 exam 全表（user_id + exam_id 过滤）聚合，Unit 行数大时未做索引评估
  （沿袭 v1.0 已知事项）。
- quick 会话之间静默替换意味着「回退到刚才没提交的那组」不可能——这是本次设计明确接受的
  （未提交选择本就不保存）。
- `useStartPractice`（专项练习 createSession + replace_active）当前无前端调用方，保留给
  专项练习入口后续实现；`ActiveSessionConflictDialog.tsx` 同理仍为既有未挂接组件。
