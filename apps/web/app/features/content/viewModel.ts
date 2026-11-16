import type { PublicUnit } from "../../api/dto/unit";

/**
 * Neutral rendering view model (M2.2 §5.1). The renderer never branches
 * on source-specific fields; printed_number always comes from the server.
 * `prompt: null` is legal (image/listening questions) — never filtered.
 */
export interface VmUnit {
  releaseId: string;
  id: string;
  kind: string;
  position: number;
  label: string | null;
  slotIds: string[];
}

export type VmAudioSource =
  | { kind: "url"; url: string }
  | { kind: "unavailable"; reason: string };

export interface VmMaterial {
  id: string;
  kind: string; // audio | transcript | passage | image | ...
  role: string | null; // primary | comparison_a | comparison_b | illustration
  language: string | null;
  content: unknown; // jlptgo-richtext-v1 payload or null
  imageAssetId: string | null;
  /** Release-scoped media URL for image materials (null: no asset). */
  imageUrl: string | null;
  audio: VmAudioSource | null; // audio materials only
}

export interface VmOption {
  id: string;
  position: number;
  content: unknown;
}

export interface VmQuestion {
  id: string;
  position: number;
  printedNumber: string | null;
  prompt: unknown; // richtext or null — null is valid
  slotId: string | null;
  options: VmOption[];
}

export interface VmContentUnit {
  unit: VmUnit;
  materials: VmMaterial[];
  questions: VmQuestion[];
}

export class ViewModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViewModelError";
  }
}
