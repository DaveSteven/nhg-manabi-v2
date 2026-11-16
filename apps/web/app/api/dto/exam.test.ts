import { describe, expect, it } from "vitest";
import {
  ExamOutlineSchema,
  ExamSummarySchema,
  LayerCatalogEntrySchema,
  parseDto,
  DtoParseError,
} from "./exam";

/** Fixture mirrors the real GET /api/exams row shape (content.py:115-127). */
const examSummary = {
  exam_id: "JLPTGO-N2-2018-12",
  release_id: "0f0e0d0c-0b0a-4948-8276-111122223333",
  revision: 3,
  level: "N2",
  year: 2018,
  month: 12,
  title: "2018年12月 N2",
};

const outline = {
  ...examSummary,
  sections: [
    {
      section_id: "sec-1",
      subject: "vocabulary",
      position: 1,
      title: "言語知識",
      layers: [
        {
          layer_id: "ly-01",
          position: 1,
          question_type_id: "vocabulary_kanji_reading",
          display_label: "問題1",
          instruction: { type: "richtext", version: "jlptgo-richtext-v1", blocks: [] },
          units: [
            {
              unit_id: "u01",
              position: 1,
              kind: "set",
              label: null,
              question_type_id: "vocabulary_kanji_reading",
              question_count: 5,
            },
          ],
        },
      ],
    },
  ],
};

describe("exam DTOs", () => {
  it("accepts the real GET /api/exams row shape", () => {
    const parsed = parseDto(ExamSummarySchema, "GET /api/exams", examSummary);
    expect(parsed.level).toBe("N2");
    expect(parsed.month).toBe(12);
  });

  it("accepts the real exam outline shape", () => {
    const parsed = parseDto(ExamOutlineSchema, "GET /api/exams/x", outline);
    expect(parsed.sections[0]?.layers[0]?.units[0]?.question_count).toBe(5);
  });

  it("accepts layers catalog with unit_count", () => {
    const { units: _dropped, ...layer } = outline.sections[0]!.layers[0]!;
    const entry = { ...layer, unit_count: 3 };
    const parsed = parseDto(LayerCatalogEntrySchema.array(), "GET layers", [entry]);
    expect(parsed[0]?.unit_count).toBe(3);
    expect("units" in parsed[0]!).toBe(false);
  });

  it("rejects unknown fields (diagnosable drift)", () => {
    const drifted = { ...examSummary, availability: "verified" };
    expect(() => parseDto(ExamSummarySchema, "GET /api/exams", drifted))
      .toThrow(DtoParseError);
  });

  it("rejects missing required fields with a path", () => {
    const missing = { ...examSummary } as Record<string, unknown>;
    delete missing.release_id;
    try {
      parseDto(ExamSummarySchema, "GET /api/exams", missing);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DtoParseError);
      expect((e as DtoParseError).message).toContain("release_id");
    }
  });

  it("rejects wrong types", () => {
    expect(() => parseDto(ExamSummarySchema, "GET /api/exams",
      { ...examSummary, year: "2018" })).toThrow(DtoParseError);
  });
});
