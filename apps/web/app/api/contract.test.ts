/**
 * Contract tests: REAL backend responses (captured by
 * scripts/e2e_capture_contract.py from a live FastAPI + PostgreSQL run over
 * a synthetic exam) must parse with the DTO schema the app uses for that
 * endpoint. Replaces hand-written mocks as the drift detector: a backend
 * field added/removed fails here, not on a user's page.
 *
 * Refresh: run the seed + server, then the capture script (see its header).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { parseDto, ExamLayersSchema, ExamOutlineSchema, ExamSummarySchema } from "./dto/exam";
import {
  CreateSessionResponseSchema, DraftSaveResultSchema, DraftsListSchema,
  FeedbackPayloadSchema, FinishResponseSchema, PracticeSessionSchema,
  ResultsResponseSchema, SubmitResultSchema,
} from "./dto/practice";
import { PublicUnitSchema } from "./dto/unit";

const SCHEMAS: Record<string, ZodType> = {
  ExamSummaryList: ExamSummarySchema.array(),
  ExamOutlineSchema,
  ExamLayersSchema,
  PublicUnitSchema,
  CreateSessionResponseSchema,
  PracticeSessionSchema,
  DraftSaveResultSchema,
  DraftsListSchema,
  SubmitResultSchema,
  FeedbackPayloadSchema,
  FinishResponseSchema,
  ResultsResponseSchema,
};

const DIR = join(__dirname, "contract-fixtures");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const LEAK = new Set(["correct_option_ids", "correct_option_id", "is_correct",
  "explanations", "answer_key", "cues"]);

function keys(o: unknown, acc: string[] = []): string[] {
  if (Array.isArray(o)) o.forEach((v) => keys(v, acc));
  else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) { acc.push(k); keys(v, acc); }
  }
  return acc;
}

describe("backend contract fixtures", () => {
  it("has captured fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  for (const f of files) {
    const fx = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    it(`${f} parses with ${fx.schema}`, () => {
      const schema = SCHEMAS[fx.schema]!;
      expect(schema, `unknown schema ${fx.schema}`).toBeDefined();
      expect(() => parseDto(schema, fx.endpoint, fx.body)).not.toThrow();
    });
  }

  it("public unit fixtures carry no answer/explanation/cue fields", () => {
    for (const f of files.filter((n) => n.startsWith("release-unit-"))) {
      const fx = JSON.parse(readFileSync(join(DIR, f), "utf8"));
      expect(keys(fx.body).filter((k) => LEAK.has(k)), f).toEqual([]);
    }
  });

  it("end-mode submit fixture reveals no correctness", () => {
    const fx = JSON.parse(readFileSync(join(DIR, "submit-end-mode.json"), "utf8"));
    expect(fx.body.feedback).toBeUndefined();
    expect(keys(fx.body).filter((k) => LEAK.has(k))).toEqual([]);
  });
});
