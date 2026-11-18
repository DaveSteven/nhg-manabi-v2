import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, describeLoadError } from "../../api/errors";
import { createMock } from "../../api/endpoints/mock";
import { Breadcrumb } from "../../components/Breadcrumb";
import { Button, ButtonLink } from "../../components/Button";
import { useAuth } from "../auth/authStore";
import { AbandonExamDialog } from "./AbandonExamDialog";
import { minutesLabel } from "./mockModel";
import { useCurrentMock, useMockAvailability } from "./useMock";

const REASON: Record<string, string> = {
  exam_not_found: "没有找到这套试卷。",
  no_phases: "这套试卷还没有考试阶段与时限数据，暂不能模拟考试。",
  phase_without_duration: "这套试卷缺少考试时限，暂不能模拟考试。",
  empty_phase: "这套试卷的考试阶段数据不完整，暂不能模拟考试。",
  units_not_ready: "这套试卷还有题目未整理完成，暂不能模拟考试。",
  listening_audio_unavailable: "这套试卷的听力音频暂未就绪，暂不能模拟考试。",
};

/** 模拟考试说明页: real phases/time limits from the release, the rules the
 * server enforces, then start (or continue the running mock). */
export function MockIntro({ examId }: { examId: string }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const avail = useMockAvailability(examId);
  const current = useCurrentMock(!!auth.user);
  const [abandonAsk, setAbandonAsk] = useState(false);

  const start = useMutation<Awaited<ReturnType<typeof createMock>>, ApiError, void>({
    mutationFn: () => createMock(examId, false),
    onSuccess: (s) => {
      void queryClient.invalidateQueries({ queryKey: ["mock", "current"] });
      navigate(`/mock/${encodeURIComponent(s.id)}`);
    },
  });

  if (!auth.user) return <Navigate to="/login" replace />;
  if (avail.isPending) return <p role="status">加载中…</p>;
  if (avail.error) return <p role="alert">{describeLoadError(avail.error, "模拟考试")}</p>;
  const a = avail.data;
  const running = current.data && current.data.state === "in_progress" ? current.data : null;
  const sameExam = running?.exam_id === examId;
  const title = a.title ?? "";

  return (
    <section aria-label="模拟考试说明" className="mock-intro">
      <Breadcrumb items={[{ label: "试卷", to: "/study/exams" },
                          { label: "详情", to: `/study/exams/${encodeURIComponent(examId)}` },
                          { label: "模拟考试" }]} />
      <h1>{a.level ? `${a.level} ` : ""}模拟考试</h1>
      {title ? <p className="text-aux">{title}</p> : null}

      {!a.available ? (
        <div className="card learning-empty" role="status">
          <p>{REASON[a.reason ?? ""] ?? "这套试卷暂不能模拟考试。"}</p>
          <ButtonLink variant="secondary" to={`/study/exams/${encodeURIComponent(examId)}`}>
            返回试卷
          </ButtonLink>
        </div>
      ) : (
        <>
          <div className="card mock-phases">
            <h2 className="module-title">考试安排</h2>
            <table className="mock-phase-table">
              <thead>
                <tr><th scope="col">阶段</th><th scope="col">时间</th><th scope="col">题量</th></tr>
              </thead>
              <tbody>
                {(a.phases ?? []).map((p) => (
                  <tr key={p.phase_id}>
                    <th scope="row">{p.position}. {p.title}</th>
                    <td>{minutesLabel(p.duration_seconds)}</td>
                    <td>{p.question_count} 题</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th scope="row">合计</th>
                    <td>{minutesLabel(a.total_seconds ?? null)}</td>
                    <td>{(a.phases ?? []).reduce((n, p) => n + p.question_count, 0)} 题</td></tr>
              </tfoot>
            </table>
          </div>

          <div className="card mock-rules">
            <h2 className="module-title">开始前请了解</h2>
            <ul>
              <li>计时由服务器控制，开始后不能暂停；刷新、断网或关闭页面，时间都会继续走。</li>
              <li>按阶段顺序作答。结束或超时后，该阶段不能回看或修改；提前结束的剩余时间不会顺延。</li>
              <li>选择答案即自动保存草稿。时间到时，已选择的答案会自动提交，没选的按未答处理（不算答错）。</li>
              <li>考试期间不显示对错、得分和解析；全部阶段结束后才生成成绩并开放回顾。</li>
              <li>成绩只显示各阶段、各科目的答对数和正确率，不做官方换算分。</li>
              <li>模拟考试与专项练习互不冲突，但同一时间只能进行一场模拟考试。</li>
            </ul>
          </div>

          {running ? (
            <div className="card mock-running" role="status">
              <p>
                你有一场进行中的模拟考试：{running.level} {running.exam_title}
                {sameExam ? "。" : "（另一套试卷）。"}
              </p>
              <div className="mock-actions">
                <ButtonLink variant="primary" to={`/mock/${encodeURIComponent(running.id)}`}>
                  继续模拟考试
                </ButtonLink>
                <Button variant="secondary" onClick={() => setAbandonAsk(true)}>放弃考试</Button>
              </div>
            </div>
          ) : null}

          <div className="mock-actions">
            {running ? null : (
              <Button variant="primary" size="lg" loading={start.isPending}
                      onClick={() => start.mutate()}>
                开始模拟考试
              </Button>
            )}
            <ButtonLink variant="secondary" size="lg" to={`/study/exams/${encodeURIComponent(examId)}`}>
              返回试卷
            </ButtonLink>
          </div>
          {start.error ? <p role="alert">无法开始：{start.error.message}</p> : null}
        </>
      )}

      {abandonAsk && running ? (
        <AbandonExamDialog sessionId={running.id} onCancel={() => setAbandonAsk(false)}
                           onDone={() => setAbandonAsk(false)} />
      ) : null}
    </section>
  );
}
