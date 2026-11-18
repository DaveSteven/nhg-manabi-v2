import { useParams } from "react-router";
import { MockIntro } from "../features/mock/MockIntro";

export default function MockIntroRoute() {
  const { examId } = useParams<{ examId: string }>();
  if (!examId) return <p role="alert">缺少试卷参数。</p>;
  return <MockIntro examId={examId} />;
}
