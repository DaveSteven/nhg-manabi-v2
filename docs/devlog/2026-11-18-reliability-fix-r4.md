# 模考听力可播放性检查 R4 · 2026-11-18

## 范围
修复 [阶段代码审查](2026-11-18-stage-code-review.md) 的 R4：结构完整但听力音频未同步的试卷不应能进入严格模考。仅开放前检查 + 分题播放登记保护；不涉及考试中的网络错误处理与真实听感验收。

## 改动
- `backend/app/api/mock_exam.py`：`_plan` 新增 `listening_audio_unavailable` 原因。对含音频素材的 Phase，需满足其一：①连续模式——该 Phase 每个 Unit 都带音频，且 exam 有 stored、非 corrupt、时长 > 0 的 `full_audio`（与 `_phase_audio` 同条件）；②分题模式——Phase 内每个音频素材都有 stored、非 corrupt、时长 > 0 的文件。否则 `GET /api/exams/{id}/mock` 返回不可用及原因，开始模考被拒。
- `start_mock_audio`：素材文件缺失/损坏/时长未知时返回 409 `audio_unavailable`，且不登记 `study_audio_plays`，不消耗一次性播放。
- `MockIntro.tsx`：新增该原因的中文提示。
- 既有听力测试夹具原本只有素材记录而无 `media_storage`，恰好依赖旧的宽松行为；`add_audio` 现同步写入 stored 记录。

## 测试（实际结果）
- 新增 7 个后端用例（clip 无文件 / 文件 unavailable / 未知时长 / 零时长 / corrupt、完整录音使分题缺失无关、录音丢失回落分题、两者皆缺、考试中文件消失后拒绝播放且不登记）。在未修复代码上 7 项失败，修复后通过。
- `backend` 全量（真实本地 PG 55432）：**269 passed, 2 skipped**。
- `apps/web`：`tsc --noEmit` 退出 0；vitest **37 files / 327 tests passed**。
- 未执行：管理端检查（未改动）、真实浏览器与真实听感、媒体请求在考试中失败的行为、对真实库中各试卷的批量可用性复核（上线前应跑一遍，确认哪些现有试卷会因此变为不可模考）。

## 剩余风险
- 现有已发布试卷中凡听力素材未同步者，模考入口会变为不可用，这是预期结果，但需要对照媒体覆盖率确认影响范围。
- 检查只看库内 `media_storage` 记录，不验证对象存储里文件实际可取。
