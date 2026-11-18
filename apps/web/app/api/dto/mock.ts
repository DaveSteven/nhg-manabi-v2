import { z } from "zod";
import { PublicUnitSchema } from "./unit";

/** GET /api/exams/{id}/mock — public: can this paper be taken as a strict
 * mock? Phases come from the real release; nothing is hard-coded here. */
export const MockPhasePlanSchema = z.object({
  phase_id: z.string(),
  position: z.number().int(),
  title: z.string(),
  duration_seconds: z.number().int().nullable(),
  playback_policy: z.unknown().nullable(),
  unit_count: z.number().int(),
  question_count: z.number().int(),
});

export const MockAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable().optional(),
  exam_id: z.string().optional(),
  title: z.string().optional(),
  level: z.string().optional(),
  phases: z.array(MockPhasePlanSchema).optional(),
  total_seconds: z.number().int().nullable().optional(),
});
export type MockAvailability = z.infer<typeof MockAvailabilitySchema>;

export const MockPhaseStateSchema = z.object({
  phase_id: z.string(),
  position: z.number().int(),
  title: z.string(),
  duration_seconds: z.number().int().nullable(),
  playback_policy: z.unknown().nullable(),
  unit_count: z.number().int(),
  status: z.enum(["upcoming", "active", "closed"]),
  started_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  remaining_seconds: z.number().int().nullable(),
});
export type MockPhaseState = z.infer<typeof MockPhaseStateSchema>;

/** Authoritative server state. `server_now` calibrates the countdown. */
export const MockStateSchema = z.object({
  id: z.string(),
  mode: z.literal("mock"),
  state: z.enum(["in_progress", "completed", "abandoned", "ended_early"]),
  exam_id: z.string(),
  exam_title: z.string(),
  level: z.string(),
  release_id: z.string(),
  created_at: z.string(),
  ended_at: z.string().nullable(),
  server_now: z.string(),
  active_phase_id: z.string().nullable(),
  phases: z.array(MockPhaseStateSchema),
  active_units: z.array(z.object({
    session_unit_id: z.string(),
    unit_id: z.string(),
    position: z.number().int(),
    state: z.string(),
  })),
  results_available: z.boolean(),
  idempotent: z.boolean().optional(),
});
export type MockState = z.infer<typeof MockStateSchema>;

/** Answer-free content of the ACTIVE phase, units tagged with their 大题. */
export const MockContentSchema = z.object({
  phase_id: z.string().nullable(),
  units: z.array(PublicUnitSchema.extend({
    session_unit_id: z.string(),
    session_unit_state: z.string(),
    layer: z.object({
      layer_id: z.string(),
      label: z.string().nullable(),
      position: z.number().int(),
      subject: z.string(),
      section_title: z.string(),
    }),
  })),
});
export type MockContent = z.infer<typeof MockContentSchema>;
export type MockContentUnit = MockContent["units"][number];

const Tally = {
  correct: z.number().int(), wrong: z.number().int(),
  skipped: z.number().int(), total: z.number().int(),
  answered_accuracy: z.number().nullable(),
};

export const MockResultsSchema = z.object({
  session_id: z.string(),
  correct_count: z.number().int(),
  wrong_count: z.number().int(),
  skipped_count: z.number().int(),
  total_count: z.number().int(),
  answered_accuracy: z.number().nullable(),
  finished_at: z.string(),
  phases: z.array(z.object({ phase_id: z.string(), title: z.string(), ...Tally })),
  subjects: z.array(z.object({ subject: z.string(), ...Tally })),
});
export type MockResults = z.infer<typeof MockResultsSchema>;
