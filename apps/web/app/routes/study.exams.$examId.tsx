import { useParams } from "react-router";
import { useExamOutline } from "../features/catalog/useExamCatalog";
import { ExamOutlineView } from "../features/catalog/ExamOutline";

export default function ExamDetailPage() {
  const { examId } = useParams<{ examId: string }>();
  const outline = useExamOutline(examId);

  if (outline.isPending) {
    return <p role="status">加载中…</p>;
  }
  if (outline.error !== null) {
    return outline.error.status === 404 ? (
      <p role="status">试卷不存在或尚未发布。</p>
    ) : (
      <p role="alert">试卷详情加载失败，请稍后重试。</p>
    );
  }
  return <ExamOutlineView outline={outline.data!} />;
}
