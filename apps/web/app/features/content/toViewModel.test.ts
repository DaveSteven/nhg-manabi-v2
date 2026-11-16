import { describe, expect, it } from "vitest";
import { toViewModel } from "./toViewModel";
import { ViewModelError } from "./viewModel";
import type { PublicUnit } from "../../api/dto/unit";

const unit: PublicUnit = {
  release_id: "r-1",
  id: "u-1",
  layer_id: "ly-1",
  question_type_id: "grammar_cloze",
  kind: "cloze",
  position: 1,
  label: "問題9",
  slot_ids: ["s1", "s2"],
  conversion_status: "complete",
  materials: [
    { id: "m1", kind: "passage", role: "primary", language: "ja-JP",
      content: { format: "jlptgo-richtext-v1", blocks: [] }, asset_id: null },
    { id: "m2", kind: "audio", role: "primary", language: "ja-JP",
      content: null, asset_id: "as-9" },
  ],
  questions: [
    { id: "q2", question_type_id: "g", position: 2, printed_number: "36",
      prompt: null, slot_id: "s2",
      conversion_status: "complete",
      options: [
        { id: "q2-o1", position: 1, content: null },
        { id: "q2-o2", position: 2, content: null },
        { id: "q2-o3", position: 3, content: null },
      ] },
    { id: "q1", question_type_id: "g", position: 1, printed_number: "35",
      prompt: null, slot_id: "s1",
      conversion_status: "complete",
      options: [
        { id: "q1-o1", position: 1, content: null },
        { id: "q1-o2", position: 2, content: null },
        { id: "q1-o3", position: 3, content: null },
        { id: "q1-o4", position: 4, content: null },
      ] },
  ],
};

describe("toViewModel", () => {
  it("maps the full unit and resolves the media URL by release+asset", () => {
    const vm = toViewModel(unit);
    expect(vm.unit.slotIds).toEqual(["s1", "s2"]);
    const audio = vm.materials.find((m) => m.audio !== null)!.audio!;
    expect(audio.kind).toBe("url");
    expect(audio.kind === "url" && audio.url)
      .toBe("/api/releases/r-1/assets/as-9");
  });

  it("keeps server printed_number/positions verbatim (never re-derived)", () => {
    const vm = toViewModel(unit);
    expect(vm.questions.map((q) => q.printedNumber)).toEqual(["36", "35"]);
    expect(vm.questions.map((q) => q.position)).toEqual([2, 1]);
    expect(vm.questions[1]!.options).toHaveLength(4);
    expect(vm.questions[0]!.options).toHaveLength(3);
  });

  it("keeps prompt=null questions (image/listening)", () => {
    const vm = toViewModel(unit);
    expect(vm.questions.every((q) => q.prompt === null)).toBe(true);
  });

  it("marks audio materials without an asset explicitly unavailable", () => {
    const noAsset = { ...unit,
      materials: [{ ...unit.materials[1]!, asset_id: null }] };
    const vm = toViewModel(noAsset);
    const audio = vm.materials[0]!.audio!;
    expect(audio.kind).toBe("unavailable");
  });

  it("throws diagnosable errors on duplicate question ids", () => {
    const dup = { ...unit,
      questions: [unit.questions[0]!, { ...unit.questions[0]!, position: 3 }] };
    expect(() => toViewModel(dup)).toThrow(ViewModelError);
    expect(() => toViewModel(dup)).toThrow(/duplicate question id q2/);
  });

  it("throws on duplicate option ids", () => {
    const dup = { ...unit, questions: [{ ...unit.questions[1]!,
      options: [unit.questions[1]!.options[0]!,
        unit.questions[1]!.options[0]!] }] };
    expect(() => toViewModel(dup)).toThrow(/duplicate option id q1-o1/);
  });
});
