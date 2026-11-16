# 2026-11-16 · 前端契约夹具（真实后端响应）

## 范围
承接 M2.3 首轮验收的遗留风险：前端 DTO 为 strictObject，手写 MSW mock 无法发现后端漂移。改为把**真实后端响应**固化为夹具，并用应用实际使用的 DTO schema 解析。

## 改动
- `scripts/e2e_capture_contract.py`：对 E2E 隔离库上的真实 uvicorn 采集 18 份响应（目录/大纲/layers、4 个 release unit、session 创建/当前/读取、草稿保存/列表、immediate 与 end 模式提交、反馈、completed 与 ended_early 的 finish、results），写入 `apps/web/app/api/contract-fixtures/*.json`（内容均为合成数据）。
- `apps/web/app/api/contract.test.ts`：每份夹具用对应 schema 解析；另断言公开 Unit 夹具无答案/解析/cues 字段、end 模式提交无正误信息。
- **契约测试立刻发现第二处漂移并修复**：`GET /api/exams/{id}/layers` 实际返回带 sections 的大纲对象（layer 含 `unit_count`），前端 schema 误建模为扁平数组。新增 `ExamLayersSchema` 并更新 `getExamLayers`。该函数当前无调用方，故尚未造成页面故障。

## 实际执行
- `pnpm -F web typecheck`：通过。
- `pnpm -F web test`：16 files / 119 passed（含 21 项契约测试，此前 98）。
- `pnpm -F web build`（含 check-build）：通过。
- 夹具采集：对真实服务器运行成功，18 份。

## 未覆盖 / 风险
- 夹具由合成 N2 形态卷生成，真实题库的边缘形态（图片、双文、长文）未覆盖。
- 夹具是快照：后端变更后需重新采集（流程见脚本头）；未做 CI 自动重采集。
- 后端 submit 内嵌 feedback 与 GET feedback 的 `feedback_mode` 不一致仍存在（前端容忍），未在后端统一。
- 错误响应形状（4xx）未纳入夹具。
- 未运行后端 pytest（本次未改后端）。
