import type { MetaFunction } from "react-router";
import { useParams } from "react-router";
import { MockExamPage } from "../features/mock/MockExam";

/** Exam Mode: its own route outside the study layout (no site navigation). */
export const meta: MetaFunction = () => [
  { title: "模拟考试 · MINAO" },
  { name: "robots", content: "noindex" },
];

export default function MockExamRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (!sessionId) return <p role="alert">缺少会话参数。</p>;
  return <MockExamPage sessionId={sessionId} />;
}
