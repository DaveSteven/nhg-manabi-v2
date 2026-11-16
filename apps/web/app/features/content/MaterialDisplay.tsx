import type { VmMaterial, VmUnit } from "./viewModel";
import { RichText } from "./richtext/RichText";

/**
 * Unit shared material — rendered once per unit, before questions
 * (practice-interactions.md visual order). Reading text uses the serif
 * reading stack with line-height 1.7–1.9; full-width characters and
 * indentation are preserved (no NFKC). A/B 双文 materials
 * (role comparison_a/b) render side by side on wide screens, stacked on
 * narrow ones.
 */
export function MaterialDisplay({ unit, materials, onDiagnostic }: {
  unit: VmUnit;
  materials: VmMaterial[];
  onDiagnostic?: (reason: string) => void;
}) {
  const passages = materials.filter((m) => m.kind === "passage" && m.content);
  const comparisonA = materials.filter((m) => m.role === "comparison_a");
  const comparisonB = materials.filter((m) => m.role === "comparison_b");
  const images = materials.filter((m) => m.kind === "image");
  const audios = materials.filter((m) => m.kind === "audio");
  void passages;

  const plainPassages = materials.filter(
    (m) => m.kind === "passage"
      && m.role !== "comparison_a" && m.role !== "comparison_b");

  return (
    <section className="material-display" aria-label="题目材料">
      {comparisonA.length > 0 || comparisonB.length > 0 ? (
        <div className="material-comparison">
          <div className="material-col">
            {comparisonA.map((m) => (
              <PassageView key={m.id} material={m} unit={unit}
                           onDiagnostic={onDiagnostic} />
            ))}
          </div>
          <div className="material-col">
            {comparisonB.map((m) => (
              <PassageView key={m.id} material={m} unit={unit}
                           onDiagnostic={onDiagnostic} />
            ))}
          </div>
        </div>
      ) : null}

      {plainPassages.map((m) => (
        <PassageView key={m.id} material={m} unit={unit}
                     onDiagnostic={onDiagnostic} />
      ))}

      {images.length > 0 ? (
        <div className="material-images">
          {images.map((m) => (
            <div key={m.id} className="richtext-image-placeholder"
                 data-asset-id={m.imageAssetId ?? undefined}>
              <div aria-hidden="true">🖼</div>
              <span className="sr-only">图片材料（{m.imageAssetId ?? "无资产"}）</span>
            </div>
          ))}
        </div>
      ) : null}

      {audios.map((m) => (
        <div key={m.id} className="material-audio-slot" data-material-id={m.id}>
          {/* AudioDock (Commit 4 practice page) mounts the fixed player;
              inline slot keeps the association discoverable. */}
          <AudioMaterialMount audio={m.audio} />
        </div>
      ))}
    </section>
  );
}

function PassageView({ material, unit, onDiagnostic }: {
  material: VmMaterial;
  unit: VmUnit;
  onDiagnostic?: (reason: string) => void;
}) {
  const label = material.role === "comparison_a" ? "A"
    : material.role === "comparison_b" ? "B"
    : null;
  return (
    <article className="reading-passage" lang={material.language ?? "ja"}>
      {label ? <h3 className="material-label">{label}</h3> : null}
      <RichText value={material.content} slotIds={unit.slotIds}
                onDiagnostic={onDiagnostic} />
    </article>
  );
}

export type AudioMaterialSource =
  | { kind: "url"; url: string }
  | { kind: "unavailable"; reason: string };

export function AudioMaterialMount({ audio }: {
  audio: VmMaterial["audio"];
}) {
  if (!audio || audio.kind === "unavailable") {
    return (
      <p className="audio-unavailable" role="status">
        🔇 音频暂不可用
        <span className="sr-only">{audio?.reason ?? "无音频"}</span>
      </p>
    );
  }
  return (
    <p className="audio-ready sr-only" data-audio-url={audio.url}>
      音频材料已就绪
    </p>
  );
}
