import { Link } from "react-router";

export interface Crumb {
  label: string;
  /** Omit on the last (current) crumb. */
  to?: string;
}

/**
 * Text-only breadcrumb for secondary pages (design-system §3.6): no
 * background, links for ancestors, the current page as plain text with
 * aria-current. Separators are decorative CSS, not content.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="面包屑" className="breadcrumb">
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${c.label}`}>
              {i > 0 ? (
                <span className="breadcrumb-sep" aria-hidden="true">›</span>
              ) : null}
              {last || !c.to ? (
                <span aria-current={last ? "page" : undefined}>{c.label}</span>
              ) : (
                <Link to={c.to}>{c.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
