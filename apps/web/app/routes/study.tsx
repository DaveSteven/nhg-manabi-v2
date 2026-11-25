import type { MetaFunction } from "react-router";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../features/auth/authStore";
import { NavSectionProvider, TopNav } from "../components/TopNav";
import { HeaderControls } from "../features/auth/HeaderControls";
import { useScrolled } from "../components/useScrolled";
import { useVisitBeacon } from "../features/auth/visitBeacon";
import { MockBanner } from "../features/mock/MockBanner";

/**
 * /study SPA layout (design-system.md v1.1 §3.1): brand left, centered
 * pill nav, level selector + account entry right (ADR-0011). All study
 * routes inherit noindex (no child route exports its own meta, so this
 * layout's meta applies). Guests are redirected to /login (ADR-0036).
 */
export const meta: MetaFunction = () => [
  { title: "我的学习 · MINAO" },
  { name: "robots", content: "noindex" },
];

/** Guest-viewable pages; everything else under /study requires login. */
const GUEST_PAGES = new Set(["/study", "/study/exams"]);

export default function StudyLayout() {
  // once the sticky header sits over scrolled content its row becomes a capsule
  const stuck = useScrolled();
  useVisitBeacon();
  const auth = useAuth();
  const location = useLocation();
  // Unified guard (ADR-0036): /study pages need a signed-in student, except the
  // browse-only entry pages (home, exam catalog). Guests (and sessions dropped
  // after a 401) go to /login, then come back. VITE_DEV_USER_TOKEN is the
  // dev-tooling identity (no cached profile).
  const isPublic = GUEST_PAGES.has(location.pathname.replace(/\/+$/, "") || "/");
  if (!auth.user && !isPublic && !import.meta.env.VITE_DEV_USER_TOKEN) {
    return <Navigate to="/login" replace
                     state={{ from: `${location.pathname}${location.search}` }} />;
  }
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
