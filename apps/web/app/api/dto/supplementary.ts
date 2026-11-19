import { z } from "zod";
import { JLPT_LEVELS } from "../endpoints/auth";

/** GET /api/supplementary/lessons?level= — 扩展练习 (ADR-0030) lesson
 * catalog. Counts cover practicable questions only; progress is the
 * caller's latest valid result per question (formal answers). */
export const LessonSchema = z.strictObject({
  exam_id: z.string(),
  lesson: z.number().int(),
  title: z.string(),
  question_count: z.number().int(),
  answered: z.number().int(),
  correct: z.number().int(),
  wrong: z.number().int(),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const SUPPLEMENTARY_SUBJECTS = ["kanji", "vocabulary", "grammar"] as const;
export type SupplementarySubject = (typeof SUPPLEMENTARY_SUBJECTS)[number];

export const LessonCatalogSchema = z.strictObject({
  level: z.enum(JLPT_LEVELS),
  subjects: z.array(z.strictObject({
    subject: z.enum(SUPPLEMENTARY_SUBJECTS),
    label_zh: z.string(),
    lessons: z.array(LessonSchema),
  })),
});
export type LessonCatalog = z.infer<typeof LessonCatalogSchema>;
