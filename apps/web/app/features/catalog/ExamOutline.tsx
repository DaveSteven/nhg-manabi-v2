import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ExamOutline, OutlineLayer, OutlineUnit } from "../../api/dto/exam";
import { Breadcrumb } from "../../components/Breadcrumb";
import { decorateSections, examTitle, subjectLabel } from "./viewModels";
import { getExamPracticeStatus } from "../../api/endpoints/sessions";
import { getCurrentSession } from "../../api/endpoints/sessions";
import { ApiError } from "../../api/errors";
import {
  isConflict,
  useStartPractice,
  type ActiveSessionConflict,
} from "../practice/useStartPractice";

/**
 * Quick Practice exam detail (quick-practice spec): compact whole-row
 * clickable units — click goes straight into practice (immediate
 * feedback, no mode/feedback selectors, no start confirmation). A
 * one-active-session conflict opens ONE dialog with 取消/继续旧练习/
 * 开始新练习; 开始新练习 uses the backend's atomic replace.
 */

interface PendingStart {
  unit: { release_id: string; unit_id: string };
  label: string;
}

export function ExamOutlineView({ outline }: { outline: ExamOutline }) {
  const navigate = useNavigate();
  const [sectionIdx, setSectionIdx] = useState(0);
  const [conflict, setConflict] = useState<(ActiveSessionConflict & {
    progress: string | null;
  }) | null>(null);
  const [pending, setPending] = useState<PendingStart | null>(null);
  const start = useStartPractice((session) => {
    navigate(`/study/practice/${encodeURIComponent(session.id)}`);
  });
  // Race: if the create mutation itself 409s (session appeared between the
  // pre-check and the POST), surface the same one dialog.
  useEffect(() => {
    const c = start.error && isConflict(start.error);
    if (c) setConflict({ ...c, progress: null });
  }, [start.error]);

  const status = useQuery({
    queryKey: ["practice-status", outline.exam_id],
    queryFn: ({ signal }) => getExamPracticeStatus(outline.exam_id, signal),
  });
  const doneUnits = new Set((status.data?.units ?? []).map((u) => u.unit_id));

  const sections = decorateSections(outline);
  const section = sections[Math.min(sectionIdx, Math.max(sections.length - 1, 0))];

  const goPractice = useCallback((sessionId: string) => {
    navigate(`/study/practice/${encodeURIComponent(sessionId)}`);
  }, [navigate]);

  /** Click a unit row: straight into practice. If the user's active
   * session already contains this unit, resume/review it instead of
   * replacing (quick-practice spec §7). */
  const openUnit = useCallback(async (unit: OutlineUnit, label: string) => {
    const target = { release_id: outline.release_id, unit_id: unit.unit_id };
    setPending({ unit: target, label });
    try {
      const current = await getCurrentSession();
      if (current.units.some((u) => u.unit_id === unit.unit_id)) {
        goPractice(current.id);
        return;
      }
      const progress = `${current.units.filter((u) => u.state === "submitted").length}/${current.units.length} 组已提交`;
      setConflict({ code: "active_session_exists",
                    activeSessionId: current.id, progress });
    } catch (e) {
      // no active session (404) or a failed status probe — just create;
      // a racing 409 is handled by the mutation error path below.
      if (!(e instanceof ApiError) || e.status === 404
          || e.status >= 500) {
        start.mutate({ units: [target], feedbackMode: "immediate" });
        return;
      }
      start.mutate({ units: [target], feedbackMode: "immediate" });
    }
  }, [outline.release_id, start, goPractice]);

  const conflictStart = useCallback((c: ActiveSessionConflict) => {
    if (!pending) return;
    start.mutate({ units: [pending.unit], feedbackMode: "immediate",
                   replaceActive: true });
    void c;
  }, [pending, start]);

  const startError = start.error && !isConflict(start.error)
    ? start.error
    : undefined;

  return (
    <section aria-label="试卷详情">
      <Breadcrumb items={[{ label: "试卷", to: "/study/exams" },
                          { label: "详情" }]} />
      <h1>{examTitle(outline)}</h1>

      <div className="tabs" role="tablist" aria-label="学科大题">
        {sections.map((s, i) => (
          <button key={s.section_id} type="button" role="tab"
                  id={`tab-${s.section_id}`}
                  aria-selected={i === sectionIdx}
                  aria-controls={`panel-${s.section_id}`}
                  onClick={() => setSectionIdx(i)}>
            {subjectLabel(s.subject)}
          </button>
        ))}
      </div>

      {section ? (
        <div role="tabpanel" id={`panel-${section.section_id}`}
             aria-labelledby={`tab-${section.section_id}`}>
          {section.layers.map((layer) => (
            <LayerBlock key={layer.layer_id} layer={layer}
                        doneUnits={doneUnits}
                        onOpen={(u) => openUnit(u, layer.display_label
                          ?? `大题 ${layer.position}`)}
                        opening={start.isPending} />
          ))}
        </div>
      ) : null}

      {startError ? (
        <p role="alert">
          开始练习失败：{startError.message}
        </p>
      ) : null}

      {conflict ? (
        <QuickPracticeConflictDialog
          examTitle={examTitle(outline)}
          progress={conflict.progress}
          onCancel={() => { setConflict(null); setPending(null); }}
          onContinue={() => {
            const id = conflict.activeSessionId;
            setConflict(null);
            setPending(null);
            if (id) goPractice(id);
          }}
          onReplace={() => { conflictStart(conflict); setConflict(null); }}
        />
      ) : null}
    </section>
  );
}

/** One dialog for the active-session conflict (§5): three actions, no
 * second confirmation — 开始新练习 uses the atomic replace API. */
function QuickPracticeConflictDialog({ examTitle: title, progress, onCancel, onContinue, onReplace }: {
  examTitle: string;
  progress: string | null;
  onCancel(): void;
  onContinue(): void;
  onReplace(): void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label="继续旧练习？"
         className="dialog card">
      <h2>继续旧练习？</h2>
      <p>
        你还有一组未完成的练习。开始新练习将结束旧练习，已提交的答案会保留。
      </p>
      <p className="text-aux">
        {title}
        {progress ? ` · ${progress}` : ""}
      </p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" onClick={onContinue}>继续旧练习</button>
        <button type="button" className="primary" onClick={onReplace}>
          开始新练习
        </button>
      </div>
    </div>
  );
}

function LayerBlock({ layer, doneUnits, onOpen, opening }: {
  layer: OutlineLayer;
  doneUnits: Set<string>;
  onOpen: (unit: OutlineUnit) => void;
  opening: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = layer.display_label ?? `大题 ${layer.position}`;
  return (
    <div className="layer-block">
      <button type="button" className="layer-toggle capsule-card"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}>
        <span className="layer-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="layer-label">{label}</span>
        <span className="layer-meta">
          {layer.units.length} 组 · {layer.units.reduce((n, u) => n + u.question_count, 0)} 题
        </span>
      </button>
      {expanded ? (
        <ul className="unit-list">
          {layer.units.map((unit) => {
            const done = doneUnits.has(unit.unit_id);
            return (
              <li key={unit.unit_id}>
                <button type="button" className="unit-row capsule-card"
                        disabled={opening}
                        aria-label={`练习 ${unit.label ?? `${label}-${unit.position}（${unit.question_count} 题）`}`}
                        onClick={() => onOpen(unit)}>
                  <span className="unit-label">
                    {unit.label ?? `${label}-${unit.position}`}
                    {done ? <span className="unit-done" aria-label="已练习">✓</span> : null}
                  </span>
                  <span className="unit-meta">{unit.question_count} 题</span>
                  <span className="unit-chevron" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                         stroke="currentColor" strokeWidth="1.8"
                         strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
