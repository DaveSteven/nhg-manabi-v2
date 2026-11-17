import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import type { FeedbackMode } from "../../api/dto/practice";
import type { ExamOutline, OutlineLayer, OutlineUnit } from "../../api/dto/exam";
import { Select } from "../../components/select";
import { Breadcrumb } from "../../components/Breadcrumb";
import { decorateSections, examTitle, subjectLabel } from "./viewModels";
import { ActiveSessionConflictDialog } from "../practice/ActiveSessionConflictDialog";
import {
  isConflict,
  useFinishSession,
  useStartPractice,
  type ActiveSessionConflict,
} from "../practice/useStartPractice";

/**
 * Exam detail: Section underline tabs (server position order) → expandable
 * Layers → Unit list. Starting a single unit creates a one-unit practice
 * session pinned to the outline's current release.
 */
const FEEDBACK_ITEMS = [
  { value: "immediate", label: "即时反馈（提交本组即看解析）" },
  { value: "end", label: "统一反馈（整卷结束后揭晓）" },
];

export function ExamOutlineView({ outline }: { outline: ExamOutline }) {
  const navigate = useNavigate();
  const [sectionIdx, setSectionIdx] = useState(0);
  const [feedbackMode, setFeedbackMode] = useState<FeedbackMode>("immediate");
  const [conflict, setConflict] = useState<ActiveSessionConflict | null>(null);
  const [pendingUnits, setPendingUnits] = useState<
    { release_id: string; unit_id: string }[]
  >([]);
  const start = useStartPractice((session) => {
    navigate(`/study/practice/${encodeURIComponent(session.id)}`);
  });
  const finish = useFinishSession();

  const sections = decorateSections(outline);
  const section = sections[Math.min(sectionIdx, Math.max(sections.length - 1, 0))];

  const startUnit = useCallback((unit: OutlineUnit) => {
    const units = [{ release_id: outline.release_id, unit_id: unit.unit_id }];
    setPendingUnits(units);
    start.mutate({ units, feedbackMode });
  }, [outline.release_id, start, feedbackMode]);

  const endAndStart = useCallback((c: ActiveSessionConflict) => {
    if (!c.activeSessionId) return;
    finish.mutate(c.activeSessionId, {
      onSuccess: () => {
        setConflict(null);
        start.mutate({ units: pendingUnits, feedbackMode });
      },
      onError: () => {
        setConflict(null);
        // Surface via mutation error UI; honest state, no silent retry.
      },
    });
  }, [finish, start, pendingUnits, feedbackMode]);

  const startError = start.error && !isConflict(start.error)
    ? start.error
    : undefined;

  return (
    <section aria-label="试卷详情">
      <Breadcrumb items={[{ label: "试卷", to: "/study/exams" },
                          { label: "详情" }]} />
      <h1>{examTitle(outline)}</h1>

      <div className="feedback-mode select-field">
        <span id="feedback-mode-label">反馈方式</span>
        <Select aria-labelledby="feedback-mode-label" value={feedbackMode}
                items={FEEDBACK_ITEMS}
                onChange={(v) => setFeedbackMode(v as FeedbackMode)} />
      </div>

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
                        onStart={startUnit}
                        starting={start.isPending} />
          ))}
        </div>
      ) : null}

      {startError ? (
        <p role="alert">
          开始练习失败：{startError.message}
        </p>
      ) : null}
      {start.isError && isConflict(start.error!) ? (
        <ActiveSessionConflictDialog
          conflict={isConflict(start.error!)!}
          onContinue={() => {
            const id = isConflict(start.error!)?.activeSessionId;
            start.reset();
            if (id) navigate(`/study/practice/${encodeURIComponent(id)}`);
          }}
          onEndAndStart={(c) => endAndStart(c)}
          onCancel={() => start.reset()}
        />
      ) : null}
    </section>
  );
}

function LayerBlock({ layer, onStart, starting }: {
  layer: OutlineLayer;
  onStart: (unit: OutlineUnit) => void;
  starting: boolean;
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
          {layer.units.map((unit) => (
            <li key={unit.unit_id} className="unit-row capsule-card">
              <span className="unit-label">{unit.label ?? `${label}-${unit.position}`}</span>
              <span className="unit-meta">{unit.question_count} 题</span>
              <button type="button" className="unit-start"
                      disabled={starting}
                      onClick={() => onStart(unit)}>
                开始练习
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
