import { useEffect, useRef, useState } from "react";
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
export function MaterialDisplay({ unit, materials, onDiagnostic, imageZoom }: {
  unit: VmUnit;
  materials: VmMaterial[];
  onDiagnostic?: (reason: string) => void;
  /** Open images in an in-page viewer (exam: never leave the page). */
  imageZoom?: boolean;
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
          {images.map((m) => <ImageMaterial key={m.id} material={m} zoom={imageZoom} />)}
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

/** Real image material (tables, figures). Click opens the full image so
 * dense tables stay legible on narrow screens; failures are explicit. */
function ImageMaterial({ material, zoom }: { material: VmMaterial; zoom?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  if (!material.imageUrl) {
    return <p className="image-unavailable" role="alert">图片暂不可用</p>;
  }
  if (failed) {
    return <p className="image-unavailable" role="alert">图片加载失败，请刷新重试。</p>;
  }
  if (zoom) {
    return (
      <figure className="material-image is-zoomable" data-asset-id={material.imageAssetId ?? undefined}>
        <button type="button" className="material-image-zoom" onClick={() => setOpen(true)}
                aria-label="放大查看图片">
          <img src={material.imageUrl} alt="题目图片" loading="lazy"
               onError={() => setFailed(true)} />
          <span className="material-image-hint" aria-hidden="true">⤢ 放大</span>
        </button>
        {open ? <ImageViewer src={material.imageUrl} onClose={() => setOpen(false)} /> : null}
      </figure>
    );
  }
  return (
    <figure className="material-image" data-asset-id={material.imageAssetId ?? undefined}>
      <a href={material.imageUrl} target="_blank" rel="noopener noreferrer"
         title="点击查看大图">
        <img src={material.imageUrl} alt="题目图片（点击查看大图）"
             loading="lazy" onError={() => setFailed(true)} />
      </a>
    </figure>
  );
}

/** Full-size viewer below the exam bar (the countdown stays visible):
 * fit-to-width or 100% (natural size, scroll/drag to pan). Esc closes. */
export function ImageViewer({ src, onClose }: { src: string; onClose(): void }) {
  const [actual, setActual] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label="查看大图">
      <div className="image-viewer-bar">
        <button type="button" aria-pressed={!actual} onClick={() => setActual(false)}>适应宽度</button>
        <button type="button" aria-pressed={actual} onClick={() => setActual(true)}>原始大小</button>
        <button type="button" ref={closeBtn} className="image-viewer-close" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="image-viewer-stage">
        <img src={src} alt="题目图片（大图）" className={actual ? "is-actual" : "is-fit"} />
      </div>
    </div>
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
