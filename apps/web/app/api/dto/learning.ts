import { z } from "zod";
import { JLPT_LEVELS } from "../endpoints/auth";

const Subject = z.enum(["vocabulary", "grammar", "reading", "listening"]);
export type LearningSubject = z.infer<typeof Subject>;

/** GET /api/me/learning/overview — derived from formal answers only. */
export const OverviewSchema = z.strictObject({
  level: z.enum(JLPT_LEVELS).nullable(),
  totals: z.strictObject({
    attempts: z.number().int(),
    correct: z.number().int(),
    wrong: z.number().int(),
    skipped: z.number().int(),
    /** correct / (correct + wrong); null (“—”) when nothing was answered. */
    answered_accuracy: z.number().nullable(),
    practiced_questions: z.number().int(),
    still_wrong_questions: z.number().int(),
    completed_sessions: z.number().int(),
    last_practiced_at: z.string().nullable(),
  }),
  coverage: z.strictObject({
    practiced_questions: z.number().int(),
    total_questions: z.number().int(),
    ratio: z.number().nullable(),
  }),
  by_subject: z.array(z.strictObject({
    subject: Subject,
    practiced_questions: z.number().int(),
    total_questions: z.number().int(),
    attempts: z.number().int(),
    correct: z.number().int(),
    wrong: z.number().int(),
    accuracy: z.number().nullable(),
    still_wrong: z.number().int(),
  })),
  weak_types: z.array(z.strictObject({
    question_type_id: z.string(),
    subject: Subject,
    label_zh: z.string(),
    attempts: z.number().int(),
    wrong: z.number().int(),
    accuracy: z.number().nullable(),
    /** fewer than the reliable sample size → show 「数据较少」, not a verdict. */
    low_sample: z.boolean(),
    still_wrong: z.number().int(),
  })),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const HistorySchema = z.strictObject({
  total: z.number().int(),
  items: z.array(z.strictObject({
    session_id: z.string(),
    mode: z.enum(["practice", "quick_practice", "mock"]),
    state: z.enum(["completed", "ended_early"]),
    feedback_mode: z.enum(["immediate", "end"]),
    happened_at: z.string(),
    level: z.string().nullable(),
    exam_id: z.string().nullable(),
    source: z.strictObject({
      kind: z.enum(["topic", "quick", "exam", "mock"]),
      label: z.string().nullable(),
    }),
    correct: z.number().int(),
    wrong: z.number().int(),
    skipped: z.number().int(),
    total: z.number().int(),
    answered_accuracy: z.number().nullable(),
    has_result: z.boolean(),
  })),
});
export type History = z.infer<typeof HistorySchema>;
export type HistoryKind = "all" | "quick" | "topic" | "mock";

export type RecordFilter = "ever_wrong" | "still_wrong" | "recovered";

/** Location + counts only: no prompt, options, answers or explanations. */
export const QuestionRecordsSchema = z.strictObject({
  filter: z.enum(["ever_wrong", "still_wrong", "recovered"]),
  total: z.number().int(),
  items: z.array(z.strictObject({
    question_id: z.string(),
    exam_id: z.string(),
    release_id: z.string(),
    exam_title: z.string(),
    level: z.string(),
    year: z.number().int(),
    month: z.number().int(),
    unit_id: z.string(),
    layer_label: z.string().nullable(),
    printed_number: z.string().nullable(),
    question_type_id: z.string(),
    question_type_label: z.string(),
    subject: Subject,
    attempt_count: z.number().int(),
    wrong_count: z.number().int(),
    last_result: z.enum(["wrong", "correct", "none"]),
    last_answered_at: z.string().nullable(),
  })),
});
export type QuestionRecords = z.infer<typeof QuestionRecordsSchema>;
