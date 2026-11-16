import { useParams } from "react-router";
import { PracticePage } from "../features/practice/PracticePage";

export default function PracticeRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (!sessionId) return <p role="alert">缺少会话参数。</p>;
  return <PracticePage sessionId={sessionId} />;
}
