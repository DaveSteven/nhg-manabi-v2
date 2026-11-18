import { useEffect } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { DraftsList } from "../../api/dto/practice";
import { ApiError, describeLoadError } from "../../api/errors";
import { getMockDrafts } from "../../api/endpoints/mock";
import { ButtonLink } from "../../components/Button";
import { useAuth } from "../auth/authStore";
import { ExamPhaseBody } from "./ExamPhaseBody";
import { useMockContent, useMockState, useServerCountdown } from "./useMock";

/**
 * Exam Mode `/mock/:sessionId` — outside the study layout (no site nav).
 * The server owns the clock: this page only displays the countdown derived
 * from the server's expiry, and re-reads the state when it reaches zero (the
 * server then seals the phase and starts the next one).
 */
export function MockExamPage({ sessionId }: { sessionId: string }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const stateQ = useMockState(sessionId);
  const state = stateQ.data;
  const active = state?.phases.find((p) => p.status === "active") ?? null;
  const remaining = useServerCountdown(
    active?.expires_at ?? null, state?.server_now, () => { void stateQ.refetch(); });

  useEffect(() => {
    if (state?.state === "completed") {
      navigate(`/study/mock/${encodeURIComponent(sessionId)}/results`, { replace: true });
    }
  }, [state?.state, navigate, sessionId]);

  if (!auth.user) return <Navigate to="/login" replace />;
  if (stateQ.isPending) return <p role="status" className="exam-status">加载考试…</p>;
  if (stateQ.error || !state) {
    return (
      <div className="exam-status" role="alert">
        <p>{stateQ.error ? describeLoadError(stateQ.error, "模拟考试") : "无法加载考试。"}</p>
        <Link to="/study/exams">返回试卷</Link>
      </div>
    );
  }
  if (state.state === "abandoned" || state.state === "ended_early") {
    return (
      <div className="exam-status" role="status">
        <p>这场模拟考试已被放弃，已交的阶段答案保留，但不会生成成绩。</p>
        <ButtonLink variant="primary" to={`/study/exams/${encodeURIComponent(state.exam_id)}/mock`}>
          重新开始
        </ButtonLink>
      </div>
    );
  }
  if (state.state === "completed" || !active) {
    return <p role="status" className="exam-status">正在生成成绩…</p>;
  }
  const isLast = state.phases.every((p) => p.position <= active.position);
  return (
    <PhaseLoader key={active.phase_id} sessionId={sessionId} state={state}
                 phase={active} remaining={remaining} isLastPhase={isLast} />
  );
}

function PhaseLoader({ sessionId, state, phase, remaining, isLastPhase }: {
  sessionId: string;
  state: NonNullable<ReturnType<typeof useMockState>["data"]>;
  phase: NonNullable<ReturnType<typeof useMockState>["data"]>["phases"][number];
  remaining: number | null;
  isLastPhase: boolean;
}) {
  const content = useMockContent(sessionId, phase.phase_id);
  const drafts = useQuery<DraftsList, ApiError>({
    queryKey: ["mock", "drafts", sessionId, phase.phase_id],
    queryFn: ({ signal }) => getMockDrafts(sessionId, signal),
    retry: 0, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false,
  });
  if (content.isPending || drafts.isPending) {
    return <p role="status" className="exam-status">加载本阶段题目…</p>;
  }
  if (content.error || drafts.error || !content.data || !drafts.data) {
    const err = content.error ?? drafts.error;
    return (
      <div className="exam-status" role="alert">
        <p>{err ? describeLoadError(err, "本阶段题目") : "无法加载题目。"}</p>
        <button type="button" onClick={() => { void content.refetch(); void drafts.refetch(); }}>
          重试
        </button>
      </div>
    );
  }
  return (
    <ExamPhaseBody sessionId={sessionId} state={state} phase={phase}
                   content={content.data} drafts={drafts.data.drafts}
                   remaining={remaining} isLastPhase={isLastPhase} />
  );
}
