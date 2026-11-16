import { releaseAssetUrl } from "../../api/endpoints/exams";
import type { PublicUnit } from "../../api/dto/unit";
import {
  ViewModelError,
  type VmContentUnit,
  type VmMaterial,
  type VmQuestion,
} from "./viewModel";

/**
 * DTO → neutral view model. Throws a diagnosable ViewModelError on
 * impossible payloads (duplicate ids etc.); printed_number is passed
 * through verbatim — array indices are NEVER used to rebuild numbering.
 */
export function toViewModel(unit: PublicUnit): VmContentUnit {
  const questionIds = new Set<string>();
  for (const q of unit.questions) {
    if (questionIds.has(q.id)) {
      throw new ViewModelError(`duplicate question id ${q.id} in unit ${unit.id}`);
    }
    questionIds.add(q.id);
    const optionIds = new Set<string>();
    for (const o of q.options) {
      if (optionIds.has(o.id)) {
        throw new ViewModelError(
          `duplicate option id ${o.id} in question ${q.id}`);
      }
      optionIds.add(o.id);
    }
  }

  const materials: VmMaterial[] = unit.materials.map((m) => ({
    id: m.id,
    kind: m.kind,
    role: m.role,
    language: m.language,
    content: m.content,
    imageAssetId: m.kind === "image" && m.asset_id ? m.asset_id : null,
    imageUrl: m.kind === "image" && m.asset_id
      ? releaseAssetUrl(unit.release_id, m.asset_id) : null,
    audio: m.kind === "audio"
      ? (m.asset_id
          ? { kind: "url" as const,
              url: releaseAssetUrl(unit.release_id, m.asset_id) }
          : { kind: "unavailable" as const,
              reason: "材料未关联音频资产" })
      : null,
  }));

  const questions: VmQuestion[] = unit.questions.map((q) => ({
    id: q.id,
    position: q.position,
    printedNumber: q.printed_number,
    prompt: q.prompt,
    slotId: q.slot_id,
    options: q.options.map((o) => ({
      id: o.id,
      position: o.position,
      content: o.content,
    })),
  }));

  return {
    unit: {
      releaseId: unit.release_id,
      id: unit.id,
      kind: unit.kind,
      position: unit.position,
      label: unit.label,
      slotIds: [...unit.slot_ids],
    },
    materials,
    questions,
  };
}
