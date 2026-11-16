import type { MetaFunction } from "react-router";
import { Link, Outlet } from "react-router";
import { TopNav } from "../components/TopNav";

/**
 * /study SPA layout (design-system.md v1.1 §3.1): brand left, centered
 * pill nav, user controls right. The controls slot stays empty — there is
 * no real account, level preference or notification state yet, and fake
 * avatars/selectors are not allowed. No prerendered content here; all
 * study routes inherit noindex (no child route exports its own meta, so
 * this layout's meta applies).
 */
export const meta: MetaFunction = () => [
  { title: "我的学习 · JLPT GO" },
  { name: "robots", content: "noindex" },
];

export default function StudyLayout() {
  return (
    <div className="study-shell">
      <header className="site-header">
        <div className="container header-row">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">日</span>
            <span className="brand-name">
              JLPT GO <span className="brand-version">2.0</span>
            </span>
          </Link>
          <TopNav />
          <div className="header-controls" />
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
