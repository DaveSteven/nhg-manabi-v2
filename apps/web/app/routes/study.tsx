import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { TopNav } from "../components/TopNav";

/**
 * /study SPA layout: top navigation + outlet. No prerendered content
 * here; all study routes inherit noindex (no child route exports its own
 * meta, so this layout's meta applies).
 */
export const meta: MetaFunction = () => [
  { title: "我的学习 · JLPT GO" },
  { name: "robots", content: "noindex" },
];

export default function StudyLayout() {
  return (
    <div className="study-shell">
      <header className="topnav-header">
        <div className="container topnav-row">
          <TopNav />
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
