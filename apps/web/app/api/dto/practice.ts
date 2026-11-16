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

export const SessionStateSchema = z.enum(["in_progress", "completed", "ended_early"]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SessionUnitSchema = z.strictObject({
  id: z.string(),
  release_id: z.string(),
  unit_id: z.string(),
  position: z.number().int(),
  state: z.enum(["pending", "submitted"]),
  submitted_at: z.string().nullable(),
});
export type SessionUnit = z.infer<typeof SessionUnitSchema>;

export const PracticeSessionSchema = z.strictObject({
  id: z.string(),
  mode: z.literal("practice"),
  feedback_mode: FeedbackModeSchema,
  state: SessionStateSchema,
  config: z.strictObject({
    requested_units: z.array(
      z.strictObject({ release_id: z.string(), unit_id: z.string() }),
    ),
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
  // GET /feedback includes it; the copy embedded in a submit response does
  // not (found in M2.3 live-server run). Nothing reads it: the session
  // carries the authoritative feedback_mode.
  feedback_mode: FeedbackModeSchema.optional(),
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
