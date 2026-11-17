import type { MetaFunction } from "react-router";
import { Link, Outlet } from "react-router";
import { NavSectionProvider, TopNav } from "../components/TopNav";
import { HeaderControls } from "../features/auth/HeaderControls";
import { useScrolled } from "../components/useScrolled";

/**
 * /study SPA layout (design-system.md v1.1 §3.1): brand left, centered
 * pill nav, level selector + account entry right (ADR-0011). All study
 * routes inherit noindex (no child route exports its own meta, so this
 * layout's meta applies).
 */
export const meta: MetaFunction = () => [
  { title: "我的学习 · JLPT GO" },
  { name: "robots", content: "noindex" },
];

export default function StudyLayout() {
  // once the sticky header sits over scrolled content its row becomes a capsule
  const stuck = useScrolled();
  return (
    <NavSectionProvider>
    <div className="study-shell">
      <header className={stuck ? "site-header is-stuck" : "site-header"}>
        <div className="container">
          <div className="header-row">
            <Link to="/" className="brand">
              <img className="brand-mark" src="/favicon.svg" alt="" width={30} height={30} />
              <span className="brand-name">
                JLPT GO <span className="brand-version">2.0</span>
              </span>
            </Link>
            <TopNav />
            <HeaderControls />
          </div>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
    </NavSectionProvider>
  );
}
