# 2026-11-24 已练习听力题原文放开

- 范围：试卷详情里「已练习 N 次」的听力题，再次练习时不再限制原文展开（用户确认；只放开原文）。
- 改动：`practice.py` 新增 `_PREVIOUSLY_PRACTICED_SQL` 与 `_transcript_gate`（原门控通过，或该用户另一条已提交同 Unit 记录，限 practice/quick_practice，不含模考）；会话 payload 每个 unit 新增 `previously_practiced`；前端 DTO 默认 false，`PracticePage` 据此放开「原文」。ADR-0035、audio-player §8 同步。无 Schema 变更。
- 测试：`test_transcript_gate.py` 新增 2 项（重练两种反馈模式原文 200 且 feedback 仍 409；他人历史不解锁），并修正原一项（改用新用户验证封闭）；后端全量 335 passed + 2 skipped（真实 PG）。web 新增 1 项（已练/未练按钮状态），全量 376 passed，tsc 通过。api/web 容器已重建。
- 未执行：浏览器验收。
- 风险：重练时先看原文会降低自测价值（用户选择）；查询每次加载会话多一个 EXISTS 子查询，单用户数据量下可忽略。
