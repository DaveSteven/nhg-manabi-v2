# 作答可靠性修复 R1–R3 · 2026-11-18

## 范围
按 [阶段代码审查](2026-11-18-stage-code-review.md) 修复 R1、R2、R3。R4（模考听力素材可用性）、模考逐题回顾/历史入口（需求待用户确认）不在本次。

## 用户决策
放弃的模考不做记录，已提交答案不能再通过普通接口读取（见 ADR-0025）。

## 改动
- **R2** `draftMachine.ts`：仅「idle/saved 且选项等于已确认值」才视为 no-op；保存中改回原选项、保存中清除均被记录，ack 后继续保存最新意图。`displayOptionId` 在 dirty/saving/save_error 时以待保存值为准（null = 已清除）。
- **R1** `pendingRetries.ts` 新增 `restorePendingRetries`，替换 PracticePage / UnifiedPractice / ExamPhaseBody 三处重复逻辑：`knownVersion === 服务端版本` 时恢复意图（含首答 0/0、清除）；版本已变化（响应丢失或他端改动）时服务端为准并丢弃该题记录；逐题清理，仅处理当前 Unit/Phase 范围，不再清空整个 Session 的记录。
- `useDraftManager.ts`：每题同一时刻仅一个保存请求（防慢网下去抖定时器带旧 `expected_row_version` 触发 409）；ack 后补发新意图。
- **R3** `backend/app/api/practice.py`：`_load_owned_session`、`_load_session_unit`、`finish`、`submit` 的会话查询限定 `mode IN ('practice','quick_practice')`，模考 ID 一律 404。

## 测试（实际结果）
- 先确认新增后端回归在未修复代码上失败（返回 200 而非 404）。
- `apps/web`：`vitest run` **37 files / 327 tests passed**（原 318，新增 draftMachine 4 项、pendingRetries 5 项）；`tsc --noEmit` 退出 0。
- `backend`（加载根目录 `.env`，真实本地 PG 55432）：`pytest` **261 passed, 2 skipped**；新增 `test_mock_id_is_invisible_to_every_practice_endpoint`（进行中/已放弃两种，覆盖 9 个 practice 端点并断言状态与 version 不变）。
- 未执行：`useDraftManager` 的 hook 级并发保存测试（单请求保护仅经类型检查与既有 MockExam/Practice 用例回归覆盖）；管理端检查（未改动）；真实浏览器、慢网/断网手测、跨设备冲突的显式冲突 UI。

## 剩余风险
- 跨设备版本变化时目前为「服务端为准，丢弃本机未保存意图」，没有显式冲突提示。
- 放弃的模考行与答案仍保留在库中（仅不可见），是否清理待决定。
- R4 未修复。
