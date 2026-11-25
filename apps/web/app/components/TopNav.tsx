import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";

/**
 * Practice/result pages live under /study/practice/:id whether they were
 * opened from 专项 or from an exam (试卷), so the URL can't say which top
 * nav item owns them. The page declares it (via its breadcrumb) and the nav
 * highlights that item. Outside a provider this is a no-op.
 */
export type NavSection = "topic" | "exams" | "supplementary" | "learning";
const NavSectionContext = createContext<{
  section: NavSection | null;
  setSection: (s: NavSection | null) => void;
} | null>(null);

export function NavSectionProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<NavSection | null>(null);
  return (
    <NavSectionContext.Provider value={{ section, setSection }}>
      {children}
    </NavSectionContext.Provider>
  );
}

export function useNavSection(section: NavSection): void {
  const ctx = useContext(NavSectionContext);
  const setSection = ctx?.setSection;
  useEffect(() => {
    setSection?.(section);
    return () => setSection?.(null);
  }, [section, setSection]);
}

/**
 * Global top navigation (design-system.md v1.1 §3): a centered floating
 * pill inside the study layout header — never a full-bar menu. Exactly
 * five items (P-002, extended by ADR-0032) with short pill labels; active state is
 * a soft sakura fill, not an underline (page-level tabs keep underlines).
 * Entries M2.2 does not implement render as explicit "暂未开放" states:
 * visible, honest, non-navigating, never fake data.
 */

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      {children}
    </svg>
  );
}

function HomeIcon() {
  return (
    <NavIcon>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </NavIcon>
  );
}

function TopicIcon() {
  return (
    <NavIcon>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </NavIcon>
  );
}

function ExamIcon() {
  return (
    <NavIcon>
      <path d="M6 3.5h9.5L19 7v13.5H6z" />
      <path d="M15 3.5V7h3.5" />
      <path d="M9 12h6M9 15.5h6" />
    </NavIcon>
  );
}

function SupplementaryIcon() {
  return (
    <NavIcon>
      <path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5Z" />
      <path d="M12 6.5V19.5" />
    </NavIcon>
  );
}

function StudyIcon() {
  return (
    <NavIcon>
      <path d="M5 20V12" />
      <path d="M12 20V5" />
      <path d="M19 20v-6" />
      <path d="M3.5 20h17" />
    </NavIcon>
  );
}

export function TopNav() {
  const section = useContext(NavSectionContext)?.section ?? null;
  const cls = (isActive: boolean, own: NavSection) =>
    `topnav-link${(section ? section === own : isActive) ? " active" : ""}`;
  // Narrow screens (<768px): the pill collapses behind a toggle and opens as a
  // dropdown. CSS decides what is visible; `open` is irrelevant on wide screens.
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={wrapRef} className={open ? "topnav-wrap is-open" : "topnav-wrap"}>
      <button type="button" className="topnav-toggle" aria-expanded={open}
              aria-controls="topnav-menu" aria-label={open ? "收起菜单" : "展开菜单"}
              onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <nav id="topnav-menu" aria-label="主导航" className="topnav">
        <NavLink to="/study" end className="topnav-link">
          <HomeIcon />
          <span>首页</span>
        </NavLink>
        <NavLink to="/study/practice" end
                 className={({ isActive }) => cls(isActive, "topic")}>
          <TopicIcon />
          <span>专项</span>
        </NavLink>
        <NavLink to="/study/exams"
                 className={({ isActive }) => cls(isActive, "exams")}>
          <ExamIcon />
          <span>试卷</span>
        </NavLink>
        <NavLink to="/study/supplementary"
                 className={({ isActive }) => cls(isActive, "supplementary")}>
          <SupplementaryIcon />
          <span>扩展</span>
        </NavLink>
        <NavLink to="/study/learning"
                 className={({ isActive }) => cls(isActive, "learning")}>
          <StudyIcon />
          <span>学习</span>
        </NavLink>
      </nav>
    </div>
  );
}
