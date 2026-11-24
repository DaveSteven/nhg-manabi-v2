import { z } from "zod";

/**
 * Practice DTOs pinned to backend/app/api/practice.py (M2.1 Task 04–08).
 * Verified contract notes:
 * - `expected_row_version: 0` means "no draft saved yet" on PUT drafts.
 * - 409 draft_version_conflict carries current_row_version in details.
 * - `units_meta` exists ONLY on the create-session response.
 * - finished sessions: completed + results, or ended_early with NO
 *   results key at all — never a fabricated score.
 */
export const FeedbackModeSchema = z.enum(["immediate", "end"]);
export type FeedbackMode = z.infer<typeof FeedbackModeSchema>;

export const SessionStateSchema = z.enum(["in_progress", "completed", "ended_early", "abandoned"]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SessionUnitSchema = z.strictObject({
  id: z.string(),
  release_id: z.string(),
  /** The exam this unit's (pinned) release belongs to — for breadcrumbs. */
  exam_id: z.string(),
  unit_id: z.string(),
  position: z.number().int(),
  state: z.enum(["pending", "submitted"]),
  submitted_at: z.string().nullable(),
  /** The caller formally submitted this unit in an earlier practice session
   *  (ADR-0035): its listening transcript is open even before submitting. */
  previously_practiced: z.boolean().default(false),
});
export type SessionUnit = z.infer<typeof SessionUnitSchema>;

export const PracticeSessionSchema = z.strictObject({
  id: z.string(),
  /** `practice` = 专项/历年试卷多 Unit 练习；`quick_practice` = 试卷目录
   * 单 Unit 快速练习（quick-practice.md v2.0）：固定 immediate、提交即
   * 完成会话，不占专项练习的单活跃名额。 */
  mode: z.enum(["practice", "quick_practice"]),
  feedback_mode: FeedbackModeSchema,
  state: SessionStateSchema,
  config: z.strictObject({
    requested_units: z.array(
      z.strictObject({ release_id: z.string(), unit_id: z.string() }),
    ),
    /** Present on 专项练习 sessions: lets 再练一组 reuse the configuration
     * (never the previously drawn units). */
    topic: z.strictObject({
      kind: z.literal("topic"),
      level: z.enum(["N1", "N2", "N3", "N4", "N5"]),
      question_type_id: z.string(),
      requested_count: z.number().int(),
      /** Sessions created before 只复习最近仍错 carry no selection. */
      selection: z.enum(["smart", "wrong_only"]).default("smart"),
    }).optional(),
    /** Sessions imported from V1 真题专项作答 (ADR-0030); not listed in 练习历史. */
    imported: z.strictObject({
      source: z.literal("v1_practice"),
      attempt_id: z.number().int(),
    }).optional(),
    /** Present on 扩展练习 lesson sessions (ADR-0030). */
    supplementary: z.strictObject({
      kind: z.literal("supplementary"),
      exam_id: z.string(),
      level: z.enum(["N1", "N2", "N3", "N4", "N5"]),
      subject: z.enum(["kanji", "vocabulary", "grammar"]),
      lesson: z.number().int(),
    }).optional(),
  }),
  version: z.number().int(),
  created_at: z.string(),
  ended_at: z.string().nullable(),
  units: z.array(SessionUnitSchema),
});
export type PracticeSession = z.infer<typeof PracticeSessionSchema>;

export const UnitsMetaSchema = z.strictObject({
  release_id: z.string(),
  unit_id: z.string(),
  layer_id: z.string(),
  question_type_id: z.string(),
  exam_id: z.string(),
  question_count: z.number().int(),
});
export type UnitsMeta = z.infer<typeof UnitsMetaSchema>;

export const CreateSessionResponseSchema = PracticeSessionSchema.extend({
  units_meta: z.array(UnitsMetaSchema).optional(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

export const DraftSaveResultSchema = z.strictObject({
  session_unit_id: z.string(),
  question_id: z.string(),
  chosen_option_id: z.string().nullable(),
  row_version: z.number().int(),
});
export type DraftSaveResult = z.infer<typeof DraftSaveResultSchema>;

export const DraftsListSchema = z.strictObject({
  drafts: z.array(
    z.strictObject({
      session_unit_id: z.string(),
      unit_id: z.string(),
      unit_position: z.number().int(),
      question_id: z.string(),
      chosen_option_id: z.string().nullable(),
      row_version: z.number().int(),
      updated_at: z.string(),
    }),
  ),
});
export type DraftsList = z.infer<typeof DraftsListSchema>;

export const ExplanationSchema = z.strictObject({
  kind: z.string(),
  language: z.string(),
  content: z.unknown(),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

export const FeedbackQuestionSchema = z.strictObject({
  question_id: z.string(),
  position: z.number().int(),
  printed_number: z.string().nullable(),
  chosen_option_id: z.string().nullable(),
  correct_option_id: z.string().nullable(),
  is_correct: z.boolean().nullable(),
  skipped: z.boolean(),
  explanations: z.array(ExplanationSchema),
});
export type FeedbackQuestion = z.infer<typeof FeedbackQuestionSchema>;

export const FeedbackPayloadSchema = z.strictObject({
  unit_id: z.string(),
  release_id: z.string(),
  feedback_mode: FeedbackModeSchema,
  questions: z.array(FeedbackQuestionSchema),
  unit_explanations: z.array(ExplanationSchema),
});
export type FeedbackPayload = z.infer<typeof FeedbackPayloadSchema>;

export const SubmitResultSchema = z.strictObject({
  session_unit_id: z.string(),
  unit_id: z.string(),
  release_id: z.string(),
  state: z.literal("submitted"),
  answered_count: z.number().int(),
  skipped_count: z.number().int(),
  idempotent: z.boolean(),
  /** Post-submit session state — quick sessions complete on submit. */
  session_state: z.enum(["in_progress", "completed", "ended_early", "abandoned"]).optional(),
  feedback: FeedbackPayloadSchema.optional(),
});
export type SubmitResult = z.infer<typeof SubmitResultSchema>;

export const ResultQuestionSchema = z.strictObject({
  unit_id: z.string(),
  unit_position: z.number().int(),
  question_id: z.string(),
  question_position: z.number().int(),
  printed_number: z.string().nullable(),
  chosen_option_id: z.string().nullable(),
  correct_option_id: z.string().nullable(),
  is_correct: z.boolean().nullable(),
  skipped: z.boolean(),
});
export type ResultQuestion = z.infer<typeof ResultQuestionSchema>;

export const StudyResultsSchema = z.strictObject({
  correct_count: z.number().int(),
  wrong_count: z.number().int(),
  skipped_count: z.number().int(),
  total_count: z.number().int(),
  score_rate: z.number(),
  answered_accuracy: z.number().nullable(),
  scoring_method: z.string(),
  scoring_version: z.string(),
  finished_at: z.string(),
  questions: z.array(ResultQuestionSchema),
});
export type StudyResults = z.infer<typeof StudyResultsSchema>;

export const ResultsResponseSchema = StudyResultsSchema.extend({
  session_id: z.string(),
});
export type ResultsResponse = z.infer<typeof ResultsResponseSchema>;

/** finish: completed+results, or ended_early with no results key. */
export const FinishResponseSchema = PracticeSessionSchema.extend({
  results: StudyResultsSchema.optional(),
  idempotent: z.boolean().optional(),
});
export type FinishResponse = z.infer<typeof FinishResponseSchema>;

/** Per-unit practice history of the caller for one exam (Quick Practice
 * unit rows). Own data only. */
export const PracticeStatusSchema = z.strictObject({
  exam_id: z.string(),
  units: z.array(z.strictObject({
    unit_id: z.string(),
    submitted_count: z.number().int(),
    last_submitted_at: z.string().nullable(),
  })),
});
export type PracticeStatus = z.infer<typeof PracticeStatusSchema>;

/**
 * Listening transcript (audio-player.md §4/§8). Served ONLY by the
 * session transcript endpoint, which shares the feedback reveal gate —
 * public unit payloads never carry cues. Cue children are a Canonical
 * richtext payload rendered through the whitelist RichText component;
 * missing/invalid timestamps are legal states (seek disabled for them).
 */
export const TranscriptCueSchema = z.strictObject({
  index: z.number().int(),
  start_ms: z.number().int().nullable().optional(),
  end_ms: z.number().int().nullable().optional(),
  children: z.unknown(),
});
export type TranscriptCue = z.infer<typeof TranscriptCueSchema>;

export const TranscriptMaterialSchema = z.strictObject({
  material_id: z.string(),
  kind: z.string(),
  language: z.string().nullable(),
  cues: z.array(TranscriptCueSchema),
  /** Present on translated transcripts; points at the source material. */
  translated_from_material_id: z.string().nullable(),
});
export type TranscriptMaterial = z.infer<typeof TranscriptMaterialSchema>;

export const TranslationCueSchema = z.strictObject({
  index: z.number().int(),
  children: z.unknown(),
});
export type TranslationCue = z.infer<typeof TranslationCueSchema>;

/** Paired zh-CN companion track — paragraph-aligned with the transcript
 * cues; server pairs 1:1 ONLY when counts match, else null. */
export const TranslationTrackSchema = z.strictObject({
  language: z.string(),
  cues: z.array(TranslationCueSchema),
});
export type TranslationTrack = z.infer<typeof TranslationTrackSchema>;

export const TranscriptPayloadSchema = z.strictObject({
  session_unit_id: z.string(),
  unit_id: z.string(),
  release_id: z.string(),
  feedback_mode: FeedbackModeSchema,
  materials: z.array(TranscriptMaterialSchema),
  translation: TranslationTrackSchema.nullable(),
});
export type TranscriptPayload = z.infer<typeof TranscriptPayloadSchema>;
