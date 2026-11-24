import {
  READING_SIZES, READING_SIZE_LABELS, useReadingScale,
} from "./useReadingScale";

/** Reading-size picker. Full: 3-radio segmented group (account page).
 *  Compact: one "Aa" button cycling the sizes (practice / exam headers). */
export function ReadingSizeControl({ compact = false }: { compact?: boolean }) {
  const { size, setSize } = useReadingScale();

  if (compact) {
    const next = READING_SIZES[(READING_SIZES.indexOf(size) + 1) % READING_SIZES.length]!;
    return (
      <button type="button" className="reading-size-btn"
              aria-label={`题目字号：${READING_SIZE_LABELS[size]}，点击切换`}
              title="题目字号" onClick={() => setSize(next)}>
        <span aria-hidden="true">Aa</span>
        <small aria-hidden="true">{READING_SIZE_LABELS[size]}</small>
      </button>
    );
  }

  return (
    <div className="reading-size-group" role="radiogroup" aria-label="题目字号">
      {READING_SIZES.map((s) => (
        <label key={s} className={s === size ? "is-on" : undefined}>
          <input type="radio" name="reading-size" value={s}
                 checked={s === size} onChange={() => setSize(s)} />
          <span>{READING_SIZE_LABELS[s]}</span>
        </label>
      ))}
    </div>
  );
}
