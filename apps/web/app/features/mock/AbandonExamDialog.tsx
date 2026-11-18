import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/errors";
import { abandonMock } from "../../api/endpoints/mock";
import { Button } from "../../components/Button";

/** Confirm giving up a running mock. Already submitted phases keep their
 * answers; no score is produced and the exam cannot be resumed. */
export function AbandonExamDialog({ sessionId, onCancel, onDone }: {
  sessionId: string;
  onCancel(): void;
  onDone(): void;
}) {
  const queryClient = useQueryClient();
  const abandon = useMutation<unknown, ApiError, void>({
    mutationFn: () => abandonMock(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mock"] });
      onDone();
    },
  });
  return (
    <div className="exam-dialog-layer">
      <div role="dialog" aria-modal="true" aria-label="放弃考试"
           className="dialog card exam-dialog">
        <h2>放弃这场模拟考试？</h2>
        <p>放弃后不能继续作答，也不会生成成绩；已交的阶段答案会保留，计时中的阶段作废。</p>
        {abandon.error ? <p role="alert">放弃失败：{abandon.error.message}</p> : null}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onCancel}>继续考试</Button>
          <Button variant="danger" loading={abandon.isPending}
                  onClick={() => abandon.mutate()}>放弃考试</Button>
        </div>
      </div>
    </div>
  );
}
