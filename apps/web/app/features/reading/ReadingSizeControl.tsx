import {
  READING_SIZES, READING_SIZE_LABELS, useReadingScale,
} from "./useReadingScale";

/** Reading-size picker. Full: three "A" glyphs of growing size as a radio
 *  group (account page, practice header). Compact: one "Aa" button cycling
 *  the sizes (tight exam bar). */
export function ReadingSizeControl({ compact = false }: { compact?: boolean }) {
  const { size, setSize } = useReadingScale();

  if (compact) {
    const next = READING_SIZES[(READING_SIZES.indexOf(size) + 1) % READING_SIZES.length]!;
    return (
      <button type="button" className="reading-size-btn"
              aria-label={`题目字号：${READING_SIZE_LABELS[size]}，点击切换`}
              title="题目字号" onClick={() => setSize(next)}>
        <span aria-hidden="true">Aa</span>
      </button>
    );
  }

  return (
    <div className="reading-size-group" role="radiogroup" aria-label="题目字号">
      {READING_SIZES.map((s) => (
        <label key={s} className={s === size ? "is-on" : undefined}
               title={READING_SIZE_LABELS[s]}>
          <input type="radio" name="reading-size" value={s}
                 aria-label={READING_SIZE_LABELS[s]}
                 checked={s === size} onChange={() => setSize(s)} />
          <span className={`glyph glyph-${s}`} aria-hidden="true">A</span>
        </label>
      ))}
    </div>
  );
}
