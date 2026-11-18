import { useParams } from "react-router";
import { MockResultsPage } from "../features/mock/MockResults";

export default function MockResultsRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (!sessionId) return <p role="alert">缺少会话参数。</p>;
  return <MockResultsPage sessionId={sessionId} />;
}
