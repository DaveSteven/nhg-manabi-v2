# 阶段代码审查与下一步建议 · 2026-11-18

## 范围与结论

- 基线：`develop`，`839da1f`；开始时工作树干净。未拉取远端，未修改业务代码、数据库或部署环境。
- 重点审查普通/专项/Quick/模考接口边界、草稿状态机与恢复、听力开放条件、学习统计及成绩入口；不是全仓安全审计或逐行审核全部导入器。
- 已完成第一阶段功能主体：题库与媒体、账户、快速练习、专项抽样与错题复习、学习概览/历史/题目记录、严格模考与连续听力。`user_question_progress` 已有维护与重建实现。
- 下一阶段应是「作答可靠性与模考闭环验收」，不能继续按旧文档安排专项/统计从零开发，也不能把实现完成视为上线验收完成。

## 发现（尚未修复）

### R1 · P1：失败草稿刷新后被丢弃

位置：`apps/web/app/features/practice/useDraftManager.ts:104–107`；`PracticePage.tsx:126–132`；`UnifiedPractice.tsx:75–80`；`features/mock/ExamPhaseBody.tsx:82–87`。

失败记录的 knownVersion 是最后确认的服务端版本，保存请求未到服务端时，两者正常应相等。恢复只接受 `knownVersion > server.rowVersion`，因此相等时直接清理本地记录：例如服务端 A/v1，断网选择 B，保存失败，刷新后回到 A。首次作答的 0/0 同样丢失。一个题目进入 else 还会清除整个 Session 的待重试记录。

建议：版本相等时恢复待保存意图；版本改变时显式冲突处理；逐题清理，并按当前 Unit/Phase 限定恢复范围。验收覆盖首答、改答、多题失败、服务端已收到但响应丢失、跨设备冲突。

### R2 · P1：保存中改回原选项被忽略

位置：`apps/web/app/features/practice/draftMachine.ts:81–86`。

服务端已存 A，选择 B 并进入 saving，再点 A，no-op 判断只比较已确认的 optionId，直接忽略新意图。B 的响应回来后最终仍为 B。已用真实 reducer 在 Node 中复现：重选 A 后显示 B，B ACK 后仍显示 B。

建议：用当前用户意图判断重复选择，并将请求中的值与后续编辑分开。验收覆盖 A→B→A、请求乱序、慢网下连续改选、清除选择；不能只断言单次成功保存。

### R3 · P1：普通结束接口可改变模考状态

位置：`backend/app/api/practice.py:982–985`、`:1017–1022`；同文件 `_feedback_gate`。

`POST /api/practice/sessions/{id}/finish` 按所有者取 Session，却不限制 mode，也不执行模考 `_advance`。传入自己进行中的 mock ID 可将其改成 ended_early；如果前面 Phase 已提交，普通 feedback/transcript 门控只拒绝 in_progress，因此这些答案可经普通接口读取，而模考专用 results 仍拒绝非 completed。这也绕过模考已定义的 abandon 流程。

这是静态调用路径发现，真实 PG 复现本次被环境权限阻止；不涉及跨用户读取。建议统一 practice 路由的模式边界，明确放弃后的反馈授权规则，补「mock ID 请求全部 practice 读写端点」回归矩阵。

### R4 · P2：可开始模考不代表听力可播放

位置：`backend/app/api/mock_exam.py:96–114`（`_plan`）；`_audio_status` / `start_mock_audio`。

可用性只检查 Phase 时长、非空与 Unit 转换状态，没有验证听力素材 stored/可服务及有效时长。完整录音不可用时回落分题播放器；分题 start 只要求存在音频材料记录，即使文件缺失仍会登记播放并消耗时间。结构完整但音频未同步的卷因此可以进入严格模考。

建议：连续/分题模式分别检查必要素材及可信时长，不满足则返回明确不可用原因；区分开放前检查和考试中网络错误。验收包含完整录音缺失但片段齐全、两者均缺失、未知时长、媒体请求失败。浏览器真实听感仍需验收。

## 下一阶段建议顺序（建议，非新增产品决策）

1. **可靠性修复**：R1–R3 优先，R4 随后；每项先补能暴露问题的回归测试。退出条件是慢网/刷新/跨端/越界接口行为一致，真实 PG 回归通过。
2. **模考闭环**：成绩页目前只有汇总；补固定原 release 的逐题回顾、听力原文/解析与独立模考历史入口。现有学习历史明确排除 mock，完成考试后缺少可发现的重新进入入口；不要把模考混进练习统计。具体页面需求待确认。
3. **端到端验收**：真实 N1–N5 样本；即时/统一反馈、skip、错→对→skip、换 release、到期与断网重连、连续听力刷新/中断；Chrome/Safari/Firefox、桌面与窄屏。对已完成与未验收分别留证。
4. **对外测试准备**：真实验证/找回邮件、登录/邮件接口限流、备份恢复演练、部署配置与错误日志、媒体覆盖率、发布快照权限。部署、推送、合并 main 仍需独立授权。

暂不建议扩展 AI、支付、排行榜或大规模 UI 重做。收藏、趋势与统计时间范围按用户反馈单独排期。

## 本次实际验证

- 学生端：在 `apps/web` 执行 `node node_modules/vitest/vitest.mjs run`，**36 files / 318 tests passed**；`node node_modules/typescript/bin/tsc --noEmit` 退出 0。测试日志有模拟请求/错误场景 stderr，不等于真实浏览器验收。
- 管理端：在 `apps/admin` 执行 `node node_modules/typescript/bin/tsc -b --pretty false` 通过；`node node_modules/vitest/vitest.mjs run --config vitest.unit.config.ts`，**6 files / 31 tests passed**；有 Vite 配置未来兼容性提示。
- reducer 定向复现：通过 TypeScript transpileModule 加载实际 draftMachine，执行 hydrate A/v1 → select B → saveStarted → select A → saveSucceeded B/v2；两次显示结果均为 B，确认 R2。此为缺陷复现，非修复通过。
- 后端未加载 DATABASE_URL 的初次测试：**63 passed / 194 skipped / 4 failed**；四个认证测试因 DATABASE_URL 缺失触发 RuntimeError，不能称后端通过。
- 按项目 .env 加载连接配置后执行模考集成测试（仅测试夹具派生的隔离库）：首项 setup 因 `127.0.0.1:55432 Operation not permitted` 失败，**1 error** 后停止；Docker socket 同样 permission denied。未成功连接或写入数据库。
- pnpm 包装命令等待无输出，已停止并改用现有本地二进制完成前端检查；未安装/升级依赖。
- 未执行生产构建、真实浏览器/音频、多视口、数据库迁移、全量 PG 回归、线上验收；历史日志的通过数字不算本次测试。

## 文档与交付

修订总体进度与文档入口中过期的当前状态，保留历史记录。本次不改变需求/架构，无新 ADR；业务缺陷留待后续修复任务。

`git diff --check` 通过。尝试将以上三份文档一起暂存并提交，但 `git add` 与 `git commit` 均因无法创建 `.git/index.lock`（Operation not permitted）失败；文档已保存，提交未完成。未推送、合并或部署。
