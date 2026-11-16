import { describe, expect, it } from "vitest";
import { PublicUnitSchema } from "./unit";
import { DtoParseError, parseDto } from "./exam";

/**
 * Fixture mirrors GET /api/exams/{exam}/units/{unit} (content.py:37-112,
 * include_private=False): materials have NO cues; question prompt may be
 * null; options carry content only.
 */
const publicUnit = {
  release_id: "0f0e0d0c-0b0a-4948-8276-111122223333",
  id: "JLPTGO-N2-2018-12-ly-01-u01",
  layer_id: "JLPTGO-N2-2018-12-ly-01",
  question_type_id: "grammar_cloze",
  kind: "cloze",
  position: 1,
  label: "問題9",
  slot_ids: ["slot-a", "slot-b"],
  conversion_status: "complete",
  materials: [
    {
      id: "m-1",
      kind: "text",
      role: "primary",
      language: "ja-JP",
      content: {
        type: "richtext", version: "jlptgo-richtext-v1",
        blocks: [{ type: "paragraph", children: [{ type: "text", text: "本文" }] }],
      },
      asset_id: null,
    },
    {
      id: "m-2",
      kind: "audio",
      role: "primary",
      language: "ja-JP",
      content: null,
      asset_id: "JLPTGO-N2-2018-12-as001",
    },
  ],
  questions: [
    {
      id: "q01",
      question_type_id: "grammar_cloze",
      position: 1,
      printed_number: "35",
      prompt: null,
      slot_id: "slot-a",
      conversion_status: "complete",
      options: [
        { id: "q01-o1", position: 1, content: { type: "richtext", version: "jlptgo-richtext-v1", blocks: [{ type: "paragraph", children: [{ type: "text", text: "选项一" }] }] } },
        { id: "q01-o2", position: 2, content: { type: "richtext", version: "jlptgo-richtext-v1", blocks: [{ type: "paragraph", children: [{ type: "text", text: "选项二" }] }] } },
        { id: "q01-o3", position: 3, content: { type: "richtext", version: "jlptgo-richtext-v1", blocks: [{ type: "paragraph", children: [{ type: "text", text: "选项三" }] }] } },
        { id: "q01-o4", position: 4, content: { type: "richtext", version: "jlptgo-richtext-v1", blocks: [{ type: "paragraph", children: [{ type: "text", text: "选项四" }] }] } },
      ],
    },
    {
      id: "q02",
      question_type_id: "vocabulary_image",
      position: 2,
      printed_number: "1番",
      prompt: null,
      slot_id: null,
      conversion_status: "complete",
      options: [
        { id: "q02-o1", position: 1, content: null },
        { id: "q02-o2", position: 2, content: null },
      ],
    },
  ],
};

describe("public unit DTO", () => {
  it("accepts the real payload shape incl. null prompt and audio material", () => {
    const parsed = parseDto(PublicUnitSchema, "GET unit", publicUnit);
    expect(parsed.questions).toHaveLength(2);
    expect(parsed.questions[1]?.prompt).toBeNull();
    expect(parsed.materials[1]?.asset_id).toContain("as001");
  });

  it("rejects a leaked cues field loudly (answer/subtitle leak guard)", () => {
    const leaked = structuredClone(publicUnit) as Record<string, unknown>;
    (leaked.materials as Record<string, unknown>[])[0]!.cues = [{ start_ms: 0 }];
    expect(() => parseDto(PublicUnitSchema, "GET unit", leaked))
      .toThrow(DtoParseError);
  });

  it("rejects non-complete conversion_status", () => {
    const draft = { ...publicUnit, conversion_status: "needs_review" };
    expect(() => parseDto(PublicUnitSchema, "GET unit", draft))
      .toThrow(DtoParseError);
  });

  it("rejects answer-key fields if they ever appear", () => {
    const leaked = structuredClone(publicUnit) as Record<string, unknown>;
    (leaked.questions as Record<string, unknown>[])[0]!.correct_option_id =
      "q01-o2";
    expect(() => parseDto(PublicUnitSchema, "GET unit", leaked))
      .toThrow(DtoParseError);
  });

  it("rejects empty slot_ids arrays? no — accepts them as valid", () => {
    const single = { ...publicUnit, slot_ids: [] };
    expect(() => parseDto(PublicUnitSchema, "GET unit", single)).not.toThrow();
  });
});
