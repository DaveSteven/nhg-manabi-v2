import { z } from "zod";

/**
 * Public Unit payload (GET /api/exams/{exam}/units/{unit} and
 * GET /api/releases/{release}/units/{unit}). NO cues, NO answer data —
 * strictObject deliberately rejects a `cues` field so a future leak of
 * subtitle timelines through the public API fails loudly here.
 * `prompt: null` is legal (image/listening questions).
 */
export const UnitMaterialSchema = z.strictObject({
  id: z.string(),
  kind: z.string(),
  role: z.string().nullable(),
  language: z.string().nullable(),
  content: z.unknown().nullable(),
  asset_id: z.string().nullable(),
});
export type UnitMaterial = z.infer<typeof UnitMaterialSchema>;

export const UnitOptionSchema = z.strictObject({
  id: z.string(),
  position: z.number().int(),
  content: z.unknown(),
});
export type UnitOption = z.infer<typeof UnitOptionSchema>;

export const UnitQuestionSchema = z.strictObject({
  id: z.string(),
  question_type_id: z.string(),
  position: z.number().int(),
  printed_number: z.string().nullable(),
  prompt: z.unknown().nullable(),
  slot_id: z.string().nullable(),
  conversion_status: z.string(),
  options: z.array(UnitOptionSchema),
});
export type UnitQuestion = z.infer<typeof UnitQuestionSchema>;

export const PublicUnitSchema = z.strictObject({
  release_id: z.string(),
  id: z.string(),
  layer_id: z.string(),
  question_type_id: z.string(),
  kind: z.string(),
  position: z.number().int(),
  label: z.string().nullable(),
  slot_ids: z.array(z.string()),
  conversion_status: z.literal("complete"),
  materials: z.array(UnitMaterialSchema),
  questions: z.array(UnitQuestionSchema),
});
export type PublicUnit = z.infer<typeof PublicUnitSchema>;
