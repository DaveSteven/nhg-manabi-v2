/** Shared "暂未开放" state for not-yet-implemented entries (no fake data). */
export function NotAvailable({ what }: { what: string }) {
  return (
    <section className="not-available card" aria-live="polite">
      <h2>{what}</h2>
      <p>该功能暂未开放。当前版本仅提供历年试卷练习。</p>
    </section>
  );
}
