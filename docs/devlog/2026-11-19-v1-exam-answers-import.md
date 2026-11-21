# 2026-11-19 · V1 真题专项作答迁移脚本

## 范围
ADR-0030：把 V1 真题专项练习（`practice_attempts`/`practice_attempt_answers`）迁成 v2 正式答案。本次只交付脚本与合成数据测试；**未对线上 V1 做 dry-run**。

## 改动
- `app/v1_answer_import.py` 增加 `--kind exam`：题映射 = V1 `identity_json` →（原始 `exam.json` 的 identity ↔ objectId）→ `source_mappings(mojitest)` → v2 题；同一 attempt 内同 Unit 的答案共用 session unit，只写真正作答的题，不伪造未答；会话 `config.imported`；教材与真题共用重判、跳过分类、幂等与进度重建逻辑。
- `learning.py`：练习历史与完成会话数排除 `config.imported` 会话（其答案仍计入覆盖率/仍错/抽样）。
- 学生端 DTO：`config.imported` 可选字段。

## 测试
- 后端 `pytest -q`（真实本地 PG 测试库）：327 passed, 2 skipped（新增 `test_v1_exam_answer_import.py` 4 项：identity→objectId→canonical 链、dry-run/幂等、按 v2 Key 重判与未映射跳过；组题 Unit 共用 session unit 且不伪造未答；导入答案计入进度但不进历史（去掉过滤后该测试失败，已变异验证）、结果接口不崩；快照 Key 不一致被跳过）。
- 学生端 `tsc --noEmit` 通过。

## 未执行 / 风险
- 未对线上 V1 的真题作答做 dry-run：需连接线上 V1 库，并在测试库先导入真实真题内容（`data/normalized_v2`，含媒体检查）、7 个用户与原始 `data/samples` 映射；真实跳过比例与改判数量未知。
- V1 专项练习历史不会出现在 v2「练习历史」里（只迁答案与统计）。
- 开发库/生产尚未导入任何 V1 数据。

## 补充：线上 V1 只读 dry-run（用户授权，2026-11-19）
- 方式：`ssh manabi` 建只读隧道读 V1；写入端用**临时数据库** `nhg_manabi_v2_dryrun`（`alembic upgrade head` 后导入真实 108 个 Canonical 包 → 105 套已发布真题、10647 条上游题映射，再导入 7 个 V1 用户），先 dry-run（回滚）再在临时库 `--apply` 以便核对错题本；结束后临时库已 DROP、隧道已关、临时文件已删。V1 线上库与 v2 开发库均未改动。
- V1 当前数据：专项练习 55 个 attempt、627 条作答（涉及 5 位用户）。
- 结果：**625 条可导入、55 个会话全部生成；跳过 2 条（`unit_not_practicable`：对应 v2 Unit 当前不是 complete）；被 v2 答案 Key 改判 0 条**（V1 当时对错与 v2 完全一致）；没有未映射题、没有未导入用户。
- 与 V1 `exam_wrong_questions`（112 行）核对：全部能映射到 v2 题；111 行在导入后同样是 v2 的「仍错」，剩 1 行没有对应作答（与被跳过的那 2 条同属不可练习 Unit 的可能性最大，未单独追查）。
- 注意：V1 仍在产生新作答，正式迁移前冻结 V1 或在切换当天重跑（按 attempt 幂等）；前置：生产部署 0019/0020、导入 7 个用户与真题内容。

## 补充二：用最新 V1 数据重跑（用户授权，2026-11-21）
- V1 线上仍在增长（教材 79 attempt/638 作答，真题专项 63 attempt/789 作答，真题错题本 131、教材错题本 120；用户仍是 7 人）。方式同前：只读隧道 + 临时库 `nhg_manabi_v2_dryrun`（真实 108 包 + 362 课扩展内容 + 7 用户），结束后已 DROP、隧道已关、临时文件已删；V1 线上库与开发库未改动。
- 教材作答：79 会话 / 638 作答**全部可导入，0 跳过、0 改判**。
- 真题作答：63 会话 / 789 作答中 **787 可导入，2 条跳过（`unit_not_practicable`），0 改判**，与上次跳过类型一致，没有新的跳过类型。
- 错题本核对：真题 131 行，全部能映射，130 行有对应的导入作答（且同样是 v2 的「仍错」），1 行无作答支撑；教材 120 行，全部有对应作答，其中 119 行在 v2 仍为「仍错」（1 行 V1 记过错但之后已答对，属正常）。
- 被跳过的 2 条作答所在的 Unit 是 v2 里 `conversion_status = needs_review` 的题组（当前已发布的真题里共有 73 个这样的 Unit，如 N1 比较阅读类，学生端不可练习）；这些 Unit 修复并重新发布后，重跑脚本即可补入（幂等按 attempt 记，已导入的 attempt 不会补入被跳过的那几条，需单独处理）。
