import { z } from "zod";
import { JLPT_LEVELS } from "../endpoints/auth";

/** GET /api/answer-distribution — aggregate only: how many keyed answers sit
 * at each option position per (level, question type). No question, paper or
 * year is ever part of it. */
export const AnswerDistributionSchema = z.strictObject({
  types: z.array(z.strictObject({
    question_type_id: z.string(),
    subject: z.enum(["vocabulary", "grammar", "reading", "listening"]),
    label_zh: z.string(),
  })),
  counts: z.array(z.strictObject({
    level: z.enum(JLPT_LEVELS),
    question_type_id: z.string(),
    position: z.number().int(),
    count: z.number().int(),
  })),
});
export type AnswerDistribution = z.infer<typeof AnswerDistributionSchema>;
