import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ExamOutline, OutlineLayer, OutlineUnit } from "../../api/dto/exam";
import { Breadcrumb } from "../../components/Breadcrumb";
import { ButtonLink } from "../../components/Button";
import { useMockAvailability } from "../mock/useMock";
import { MockRecords } from "../mock/MockRecords";
import { decorateSections, examTitle, subjectLabel } from "./viewModels";
import { getExamPracticeStatus } from "../../api/endpoints/sessions";
import { useQuickPracticeStart } from "../practice/useStartPractice";

/**
 * Quick Practice exam detail (quick-practice.md v2.0): whole-row clickable
 * units — a click creates a `quick_practice` session server-side and goes
 * straight into answering. No mode/feedback selector, no start
 * confirmation, and NO active-session conflict dialog: quick sessions live
 * in their own mode (they never occupy 专项练习's single-active slot) and
 * a stale quick session is silently replaced server-side, so there is
 * nothing to ask. Unit rows show the caller's REAL practice count from
 * `/practice-status` (never a frontend-accumulated state).
 */

/** 未练习 / 已练习 <N> 次 — the number is highlighted like layer-progress. */
function PracticeCount({ count }: { count: number | undefined }) {
  if (!count) return <>未练习</>;
  return <>已练习 <span className="unit-count">{count}</span> 次</>;
}

export function ExamOutlineView({ outline }: { outline: ExamOutline }) {
  const navigate = useNavigate();
  const [sectionIdx, setSectionIdx] = useState(0);
  const start = useQuickPracticeStart((session) => {
    navigate(`/study/practice/${encodeURIComponent(session.id)}`);
  });

  const status = useQuery({
    queryKey: ["practice-status", outline.exam_id],
    queryFn: ({ signal }) => getExamPracticeStatus(outline.exam_id, signal),
  });
  const counts = new Map(
    (status.data?.units ?? []).map((u) => [u.unit_id, u.submitted_count]),
  );

  // strict-mock entry only for papers with real phases/time limits (M10)
  const mock = useMockAvailability(outline.exam_id);

  const sections = decorateSections(outline);
  const section = sections[Math.min(sectionIdx, Math.max(sections.length - 1, 0))];

  const openUnit = useCallback((unit: OutlineUnit) => {
    start.mutate({ release_id: outline.release_id, unit_id: unit.unit_id });
  }, [outline.release_id, start]);

  return (
    <section aria-label="试卷详情">
      <Breadcrumb items={[{ label: "试卷", to: "/study/exams" },
                          { label: "详情" }]} />
      <div className="exam-title-row">
        <h1>{examTitle(outline)}</h1>
        {mock.data?.available ? (
          <ButtonLink variant="secondary"
                      to={`/study/exams/${encodeURIComponent(outline.exam_id)}/mock`}>
            模拟考试
          </ButtonLink>
        ) : null}
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
                        counts={counts}
                        onOpen={openUnit}
                        opening={start.isPending} />
          ))}
        </div>
      ) : null}

      <MockRecords examId={outline.exam_id} />

      {start.error ? (
        <p role="alert">
          开始练习失败：{start.error.message}
        </p>
      ) : null}
    </section>
  );
}

function LayerBlock({ layer, counts, onOpen, opening }: {
  layer: OutlineLayer;
  counts: Map<string, number>;
  onOpen: (unit: OutlineUnit) => void;
  opening: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = layer.display_label ?? `大题 ${layer.position}`;
  // X: distinct units with at least one formal practice; repeats of the
  // same unit do not increase it. Y: all units of the layer.
  const practiced = layer.units.filter(
    (u) => (counts.get(u.unit_id) ?? 0) > 0).length;
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
          已练习<span className="layer-progress">{practiced}/{layer.units.length}</span>
        </span>
      </button>
      {expanded ? (
        <ul className="unit-list">
          {layer.units.map((unit) => (
            <li key={unit.unit_id}>
              <button type="button" className="unit-row capsule-card"
                      disabled={opening}
                      aria-label={`练习 ${unit.label ?? `${label}-${unit.position}（${unit.question_count} 题）`}`}
                      onClick={() => onOpen(unit)}>
                <span className="unit-label">
                  {unit.label ?? `${label}-${unit.position}`}
                </span>
                <span className="unit-meta">
                  <PracticeCount count={counts.get(unit.unit_id)} />
                </span>
                <span className="unit-chevron" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                       stroke="currentColor" strokeWidth="1.8"
                       strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
