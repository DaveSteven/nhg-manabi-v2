import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/Button";
import {
  READING_SCALES, READING_STEP_LABELS, READING_STEPS, useReadingScale,
  type ReadingStep,
} from "./useReadingScale";

/** "字号设置" button; opens a dialog with a snapped slider and live preview
 *  of the question content. `compact` shortens the label for tight bars. */
export function ReadingSizeControl({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" aria-haspopup="dialog"
              onClick={() => setOpen(true)}>
        {compact ? "字号" : "字号设置"}
      </Button>
      {open ? <ReadingSizeDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ReadingSizeDialog({ onClose }: { onClose(): void }) {
  const { step: saved, setStep: save } = useReadingScale();
  // draft: the slider only previews; the page changes on 完成
  const [step, setStep] = useState<ReadingStep>(saved);
  const titleId = useId();
  const sliderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sliderRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="reading-size-scrim" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
           className="reading-size-dialog card"
           onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId}>字号设置</h2>
        <p className="text-aux">只调整题干、选项、材料和解析，导航等界面不变。点「完成」后生效。</p>

        <div className="reading-size-preview" lang="ja" aria-label="预览"
             style={{ "--reading-scale": READING_SCALES[step] } as React.CSSProperties}>
          <div className="richtext">
            <p>この店の客は女性が80%を<u>占める</u>。</p>
            <p className="preview-option">① しめる　② つめる　③ せめる　④ うめる</p>
          </div>
        </div>

        <div className="reading-size-slider">
          <span className="end end-small" aria-hidden="true">A</span>
          <input ref={sliderRef} type="range" aria-label="题目字号"
                 min={0} max={READING_STEPS.length - 1} step={1} value={step}
                 aria-valuetext={READING_STEP_LABELS[step]}
                 onChange={(e) => setStep(Number(e.target.value) as ReadingStep)} />
          <span className="end end-large" aria-hidden="true">A</span>
        </div>
        <p className="reading-size-current" aria-live="polite">
          {READING_STEP_LABELS[step]}
        </p>

        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setStep(0)}
                  disabled={step === 0}>恢复标准</Button>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button variant="primary"
                  onClick={() => { save(step); onClose(); }}>完成</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
