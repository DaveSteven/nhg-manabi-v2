import { z } from "zod";

/**
 * Content DTOs, pinned to backend/app/api/content.py wire shapes (public,
 * published-release payloads only). strictObject so unknown or missing
 * fields surface as diagnosable parse errors instead of silent drift.
 * Richtext JSON bodies arrive as unknown here; the renderer (Commit 3)
 * validates jlptgo-richtext-v1 separately.
 */

/** Exam identity shared by the list row, the outline and the layer catalog. */
const ExamHeadSchema = z.strictObject({
  exam_id: z.string(),
  release_id: z.string(),
  revision: z.number().int(),
  level: z.string(),
  year: z.number().int(),
  month: z.number().int(),
  title: z.string(),
});

/** GET /api/exams row: the head plus the practiceable question count. */
export const ExamSummarySchema = ExamHeadSchema.extend({
  /** Questions in the practiceable units of the current release. */
  question_count: z.number().int(),
});
export type ExamSummary = z.infer<typeof ExamSummarySchema>;

export const OutlineUnitSchema = z.strictObject({
  unit_id: z.string(),
  position: z.number().int(),
  kind: z.string(),
  label: z.string().nullable(),
  question_type_id: z.string(),
  question_count: z.number().int(),
});
export type OutlineUnit = z.infer<typeof OutlineUnitSchema>;

export const OutlineLayerSchema = z.strictObject({
  layer_id: z.string(),
  position: z.number().int(),
  question_type_id: z.string(),
  /** question_types.label_zh, e.g. 汉字读音 (absent on older servers). */
  question_type_label: z.string().nullable().optional(),
  display_label: z.string().nullable(),
  instruction: z.unknown().nullable(),
  units: z.array(OutlineUnitSchema),
});
export type OutlineLayer = z.infer<typeof OutlineLayerSchema>;

export const OutlineSectionSchema = z.strictObject({
  section_id: z.string(),
  subject: z.string(),
  position: z.number().int(),
  title: z.string(),
  layers: z.array(OutlineLayerSchema),
});
export type OutlineSection = z.infer<typeof OutlineSectionSchema>;

export const ExamOutlineSchema = ExamHeadSchema.extend({
  sections: z.array(OutlineSectionSchema),
});
export type ExamOutline = z.infer<typeof ExamOutlineSchema>;

/** GET /api/exams/{id}/layers: unit_count instead of the units array. */
export const LayerCatalogEntrySchema = OutlineLayerSchema.omit({
  units: true,
}).extend({
  unit_count: z.number().int(),
});
export type LayerCatalogEntry = z.infer<typeof LayerCatalogEntrySchema>;

/**
 * Actual GET /api/exams/{id}/layers body: the same sectioned outline as
 * GET /api/exams/{id} but with per-layer unit_count instead of units
 * (found by the contract fixtures; earlier modelled as a flat array).
 */
export const ExamLayersSchema = ExamHeadSchema.extend({
  sections: z.array(OutlineSectionSchema.extend({
    layers: z.array(LayerCatalogEntrySchema),
  })),
});
export type ExamLayers = z.infer<typeof ExamLayersSchema>;

export class DtoParseError extends Error {
  readonly issues: string;
  constructor(endpoint: string, issues: string) {
    super(`DTO validation failed for ${endpoint}:\n${issues}`);
    this.name = "DtoParseError";
    this.issues = issues;
  }
}

export function parseDto<T>(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] }; data?: T } },
                            endpoint: string, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = (result.error?.issues ?? [])
      .map((i) => JSON.stringify(i))
      .join("\n");
    throw new DtoParseError(endpoint, issues || "unknown parse failure");
  }
  return result.data as T;
}
