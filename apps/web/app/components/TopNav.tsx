import { NavLink } from "react-router";

/**
 * Global top navigation — exactly four items (product rule P-002), active
 * item via thin underline. Entries that M2.2 does not implement render as
 * explicit "暂未开放" states: visible, honest, non-navigating, never fake
 * data.
 */
export function TopNav() {
  return (
    <nav aria-label="主导航" className="topnav">
      <NavLink to="/study" end className="topnav-link">
        首页
      </NavLink>
      <button type="button" className="topnav-link topnav-unavailable"
              aria-disabled="true">
        专项练习<span className="sr-only">（暂未开放）</span>
      </button>
      <NavLink to="/study/exams" className="topnav-link">
        历年试卷
      </NavLink>
      <button type="button" className="topnav-link topnav-unavailable"
              aria-disabled="true">
        我的学习<span className="sr-only">（暂未开放）</span>
      </button>
    </nav>
  );
}
