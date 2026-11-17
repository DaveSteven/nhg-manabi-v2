import { Button } from "./Button";

/** Page numbers to show: first, last, and a window around the current page,
 * with "…" for gaps (e.g. 1 … 4 5 6 … 20). Pure, so it is unit-tested. */
export function pageItems(current: number, pages: number, around = 1): (number | "…")[] {
  const keep = new Set<number>([0, pages - 1]);
  for (let p = current - around; p <= current + around; p++) {
    if (p >= 0 && p < pages) keep.add(p);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = -1;
  for (const p of sorted) {
    if (prev >= 0 && p - prev > 1) {
      // a single missing page is cheaper to show than an ellipsis
      out.push(p - prev === 2 ? p - 1 : "…");
    }
    out.push(p);
    prev = p;
  }
  return out;
}

/** Numbered pagination with a total count (zero-based `page`). Renders
 * nothing when everything fits on one page. */
export function Pagination({ page, total, pageSize, onPage }: {
  page: number; total: number; pageSize: number; onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="分页">
      <span className="pagination-total">共 {total} 条</span>
      <div className="pagination-controls">
        <Button variant="secondary" disabled={page === 0}
                onClick={() => onPage(page - 1)}>上一页</Button>
        <ol className="pagination-pages">
          {pageItems(page, pages).map((it, i) => (
            <li key={`${it}-${i}`}>
              {it === "…" ? <span aria-hidden="true" className="pagination-gap">…</span> : (
                <button type="button" className="pagination-page"
                        aria-label={`第 ${it + 1} 页`}
                        aria-current={it === page ? "page" : undefined}
                        onClick={() => onPage(it)}>
                  {it + 1}
                </button>
              )}
            </li>
          ))}
        </ol>
        <Button variant="secondary" disabled={page + 1 >= pages}
                onClick={() => onPage(page + 1)}>下一页</Button>
      </div>
    </nav>
  );
}
