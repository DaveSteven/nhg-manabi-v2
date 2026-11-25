import type { MetaFunction } from "react-router";
import { Link, Outlet } from "react-router";
import { NavSectionProvider, TopNav } from "../components/TopNav";
import { HeaderControls } from "../features/auth/HeaderControls";
import { useScrolled } from "../components/useScrolled";
import { useVisitBeacon } from "../features/auth/visitBeacon";
import { MockBanner } from "../features/mock/MockBanner";

/**
 * /study SPA layout (design-system.md v1.1 §3.1): brand left, centered
 * pill nav, level selector + account entry right (ADR-0011). All study
 * routes inherit noindex (no child route exports its own meta, so this
 * layout's meta applies).
 */
export const meta: MetaFunction = () => [
  { title: "我的学习 · MINAO" },
  { name: "robots", content: "noindex" },
];

export default function StudyLayout() {
  // once the sticky header sits over scrolled content its row becomes a capsule
  const stuck = useScrolled();
  useVisitBeacon();
  return (
    <NavSectionProvider>
    <div className="study-shell">
      <header className={stuck ? "site-header is-stuck" : "site-header"}>
        <div className="container">
          <div className="header-row">
            <Link to="/" className="brand">
              <img className="brand-mark" src="/favicon.svg" alt="" width={30} height={30} />
              <img className="brand-wordmark" src="/minao-wordmark.svg" alt="MINAO" width={102} height={26} />
            </Link>
            <TopNav />
            <HeaderControls />
          </div>
        </div>
      </header>
      <MockBanner />
      <main className="container">
        <Outlet />
      </main>
    </div>
    </NavSectionProvider>
  );
}
