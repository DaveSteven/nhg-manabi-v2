# Devlog · Quick Practice 快速练习交互（quick-practice.md v1.0 落地）

日期：2026-11-17 · 分支：develop · 规范入库：`docs/design/quick-practice.md`

## 范围

历年试卷普通练习按 Quick Practice 规范简化：直点即练、无多余弹窗、单活跃冲突一次处理、
原子替换；后端继续保证单活跃约束、幂等与答案权限。专项/模考不在本次范围。

## 改动

### 后端（`backend/app/api/practice.py`）
1. `POST /api/practice/sessions` 新增 `replace_active`（默认 false）：为 true 且存在活跃普通练习时，
   **同一事务内**结束旧会话（state='ended_early'、ended_at、version+1——与 finish-with-pending 语义
   完全一致）并创建新会话；消除旧「先 finish 再 create」的失败窗口。并发重复请求仍由
   `ux_one_active_practice` 部分唯一索引拒绝（409），不会产生两个进行中会话。
2. 新增 `GET /api/exams/{exam_id}/practice-status`：**调用者本人**在该试卷任意 release 下的
   per-unit 正式提交历史（submitted_count / last_submitted_at），仅本人数据，零答案内容。
3. 新增 `backend/tests/test_quick_practice.py`（5 项）：原子替换（旧会话 ended_early、已提交答案
   保留 2 条、旧会话无成绩 409）、无活跃会话时 replace 直接创建、连续三次 replace 仅一个活跃、
   replace=false 仍 409、practice-status 只见本人历史。

### 前端
1. **试卷详情页（ExamOutline）**：
   - 移除「反馈方式」下拉框（单 Unit 默认即时反馈，§6）。
   - Unit 行改为**整行按钮**（标题 + 题数 + ✓已练状态 + Chevron），无行内「开始练习」按钮；
     新增 `getExamPracticeStatus` 驱动已练状态。
   - 点击流程：先查 `GET /sessions/current`——活跃会话已含该 Unit → **直接恢复**（不替换）；
     含其它 Unit → 一次冲突弹窗「继续旧练习？」（取消 / 继续旧练习 / 开始新练习）；
     无活跃会话 → 直接创建。弹窗按规范文案展示试卷标题与进度（已提交组数）。
   - `开始新练习` 走 `replace_active=true` 原子替换，**无第二次确认**；创建成功（后端确认）才导航。
   - create 请求即使竞态 409 也回落到同一弹窗（mutation error → state）。
2. **答题页（PracticePage）**：
   - 全部已答 → 点「提交本组」**直接提交**，不弹窗；仅有未答题时弹一次「还有题目未作答」
     （文案与按钮按规范：继续答题 / 确认提交）。
   - 提交后新增**下一组 / 返回试卷**就地导航（多 Unit 会话按 position 顺序前进；无下一组时
     只显示返回试卷），反馈仍就地展示，不强制跳转结果页。
3. API 层：`createSession` 携带 `replace_active`（显式默认 false）；新增 practice-status 端点与
   `PracticeStatusSchema` DTO。

## 测试结果（真实输出）

- 后端全量：**174 passed + 2 skipped**（含新 quick_practice 5 项与 transcript 门控 7 项）。
- 前端全量：**224 passed**（ExamOutline 重写为 Quick Practice 流程的 6 项 MSW 集成测试：
  整行按钮/无反馈框、直点创建 immediate 会话、含该 Unit 时恢复不替换、冲突弹窗三操作且
  replace_active=true 无二次确认、非冲突错误无弹窗；PracticePage/SubmitDialogs 文案同步）。
- `pnpm typecheck`、`pnpm build`（预渲染/noindex/凭据检查）通过。
- 容器：`docker compose build migrate web` + `up -d api web` 后冒烟——发现 **api 服务镜像由
  migrate 服务构建**（compose 里 api 只有 image 无 build 段），只 build api 会用旧镜像；已用
  migrate 重建。`:8080` 冒烟 200；`GET /api/exams/{id}/practice-status` 未认证正确 401。

## 决策说明

- 活跃会话已含该 Unit 时**恢复而非替换**（规范 §7：已提交显示复盘、未提交恢复草稿）；跨旧会话
  重新练习已提交 Unit 时会创建新会话（replace 或常规创建），历史提交记录不动。
- 「练习状态」仅标 ✓ 已练（有正式提交），不做次数/时间展示——保持行内紧凑。

## 未执行 / 剩余风险

- 真实浏览器端到端走查未执行（交用户 :8080 实测；后端门控与前端集成测试已覆盖关键路径）。
- practice-status 查询未做索引评估：当前按 user + exam 关联聚合，105 套库下单用户数据量小，
  如未来单用户提交量增大需加索引。
- Firefox/Safari、深色模式未测（既有缺口）。
