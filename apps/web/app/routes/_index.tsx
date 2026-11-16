import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { SITE_URL } from "../api/env";

/**
 * Brand home (SSG, prerendered). Full copy lives in initial HTML — it
 * must render with JavaScript disabled. No user identity, no private
 * question data, no answer content may enter this page at build time.
 * Copy is minimal placeholder until real brand content is written.
 */
export const meta: MetaFunction = ({ location }) => [
  { title: "JLPT GO · 日语能力考学习平台" },
  { name: "description", content: "JLPT GO：面向日语能力考试（JLPT）的系统化练习平台，提供历年试卷专项练习。" },
  { name: "robots", content: "index,follow" },
  { rel: "canonical", href: `${SITE_URL}${location.pathname}` },
  { property: "og:title", content: "JLPT GO · 日语能力考学习平台" },
  { property: "og:description", content: "面向日语能力考试的系统化练习平台。" },
];

export default function BrandHome() {
  return (
    <main className="container brand-home">
      <h1>JLPT GO</h1>
      <p>
        面向日语能力考试（JLPT）的系统化练习平台：历年试卷专项练习，
        按大题与题目组精练，服务器判题与解析复盘。
      </p>
      <p>
        <Link to="/study">进入学习</Link>
      </p>
      <section>
        <h2>功能</h2>
        <ul>
          <li>历年试卷：按年份与等级浏览真题，按大题（Unit）练习。</li>
          <li>服务器判题：选择即保存，正式提交才计分，刷新后恢复进度。</li>
          <li>解析复盘：即时反馈或交卷后统一揭晓，历史结果永久追溯。</li>
        </ul>
      </section>
    </main>
  );
}
