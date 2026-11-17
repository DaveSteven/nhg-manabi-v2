import { z } from "zod";
import { JLPT_LEVELS } from "../endpoints/auth";

/** GET /api/topic-practice/types?level= — real counts of practicable
 * Units per Canonical question type (never the printed 問題 number). */
export const TopicTypeSchema = z.strictObject({
  question_type_id: z.string(),
  subject: z.enum(["vocabulary", "grammar", "reading", "listening"]),
  label_zh: z.string(),
  label_ja: z.string(),
  unit_kind: z.string(),
  is_provisional: z.boolean(),
  available_units: z.number().int(),
  available_questions: z.number().int(),
  /** Units the caller has never formally submitted. */
  new_units: z.number().int(),
  /** Units that still hold a question whose latest valid answer is wrong. */
  wrong_units: z.number().int(),
});
/** smart: new-first + ~25% review; wrong_only: only still-wrong Units. */
export type TopicSelection = "smart" | "wrong_only";

export type TopicType = z.infer<typeof TopicTypeSchema>;

export const TopicTypesSchema = z.strictObject({
  level: z.enum(JLPT_LEVELS),
  types: z.array(TopicTypeSchema),
});
export type TopicTypes = z.infer<typeof TopicTypesSchema>;
