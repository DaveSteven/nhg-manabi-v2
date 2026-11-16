import type { ReactNode } from "react";
import { NavLink } from "react-router";

/**
 * Global top navigation (design-system.md v1.1 §3): a centered floating
 * pill inside the study layout header — never a full-bar menu. Exactly
 * four items (product rule P-002) with short pill labels; active state is
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
  return (
    <nav aria-label="主导航" className="topnav">
      <NavLink to="/study" end className="topnav-link">
        <HomeIcon />
        <span>首页</span>
      </NavLink>
      <button type="button" className="topnav-link topnav-unavailable"
              aria-disabled="true">
        <TopicIcon />
        <span>专项</span>
        <span className="sr-only">（暂未开放）</span>
      </button>
      <NavLink to="/study/exams" className="topnav-link">
        <ExamIcon />
        <span>试卷</span>
      </NavLink>
      <button type="button" className="topnav-link topnav-unavailable"
              aria-disabled="true">
        <StudyIcon />
        <span>学习</span>
        <span className="sr-only">（暂未开放）</span>
      </button>
    </nav>
  );
}
