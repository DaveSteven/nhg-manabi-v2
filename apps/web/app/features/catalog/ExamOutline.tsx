import { useCallback, useState } from "react";
import { readTabSubject, saveTabSubject } from "./tabMemory";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/authStore";
import { useQuery } from "@tanstack/react-query";
import type { ExamOutline, OutlineLayer, OutlineUnit } from "../../api/dto/exam";
import { Breadcrumb } from "../../components/Breadcrumb";
import { ButtonLink } from "../../components/Button";
import { useMockAvailability } from "../mock/useMock";
import { MockRecords } from "../mock/MockRecords";
import { decorateSections, examTitle, subjectLabel } from "./viewModels";
import { getExamPracticeStatus } from "../../api/endpoints/sessions";
import { useLayerPracticeStart, useQuickPracticeStart } from "../practice/useStartPractice";

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
  const location = useLocation();
  const signedIn = useAuth().user !== null;
  // Guests may read the outline; the first "start" asks them to sign in and
  // brings them back to this exact page (ADR-0036).
  const requireLogin = useCallback(() => {
    navigate("/login", { state: {
      from: `${location.pathname}${location.search}`,
      intent: examTitle(outline),
    } });
  }, [navigate, location.pathname, location.search, outline]);
  // selected tab is remembered by subject (not index) across visits
  const [subjectKey, setSubjectKey] = useState<string | null>(
    () => readTabSubject(outline.exam_id));
  const start = useQuickPracticeStart((session) => {
    navigate(`/study/practice/${encodeURIComponent(session.id)}`);
  });

  const status = useQuery({
    queryKey: ["practice-status", outline.exam_id],
    queryFn: ({ signal }) => getExamPracticeStatus(outline.exam_id, signal),
    enabled: signedIn,
  });
  const counts = new Map(
    (status.data?.units ?? []).map((u) => [u.unit_id, u.submitted_count]),
  );

  const startLayer = useLayerPracticeStart((session) => {
    navigate(`/study/practice/${encodeURIComponent(session.id)}`);
  });
  const openLayer = useCallback((layer: OutlineLayer) => {
    if (!signedIn) { requireLogin(); return; }
    startLayer.mutate({ units: layer.units.map((u) => ({
      release_id: outline.release_id, unit_id: u.unit_id })) });
  }, [outline.release_id, startLayer, signedIn, requireLogin]);

  // strict-mock entry only for papers with real phases/time limits (M10)
  const mock = useMockAvailability(outline.exam_id);

  const sections = decorateSections(outline);
  const found = sections.findIndex((s) => s.subject === subjectKey);
  const sectionIdx = found >= 0 ? found : 0; // unknown/missing subject → first
  const section = sections[sectionIdx];

  const openUnit = useCallback((unit: OutlineUnit) => {
    if (!signedIn) { requireLogin(); return; }
    start.mutate({ release_id: outline.release_id, unit_id: unit.unit_id });
  }, [outline.release_id, start, signedIn, requireLogin]);

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

      {signedIn ? null : (
        <p className="text-aux" role="note">登录后可开始练习，并记录每道题的作答和进度。</p>
      )}

      <div className="tabs" role="tablist" aria-label="学科大题">
        {sections.map((s, i) => (
          <button key={s.section_id} type="button" role="tab"
                  id={`tab-${s.section_id}`}
                  aria-selected={i === sectionIdx}
                  aria-controls={`panel-${s.section_id}`}
                  onClick={() => {
                    setSubjectKey(s.subject);
                    saveTabSubject(outline.exam_id, s.subject);
                  }}>
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
                        onOpenLayer={openLayer}
                        // 文字词汇/文法: 点開問題N直接练习整个大题
                        direct={section.subject === "vocabulary"
                                || section.subject === "grammar"}
                        opening={start.isPending || startLayer.isPending} />
          ))}
        </div>
      ) : null}

      {signedIn ? <MockRecords examId={outline.exam_id} /> : null}

      {start.error || startLayer.error ? (
        <p role="alert">
          开始练习失败：{(start.error ?? startLayer.error)?.message}
        </p>
      ) : null}
    </section>
  );
}

function LayerBlock({ layer, counts, onOpen, onOpenLayer, direct, opening }: {
  layer: OutlineLayer;
  counts: Map<string, number>;
  onOpen: (unit: OutlineUnit) => void;
  onOpenLayer: (layer: OutlineLayer) => void;
  /** true: the whole 問題N row starts practice of all its Units at once. */
  direct: boolean;
  opening: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = layer.display_label ?? `大题 ${layer.position}`;
  // X: distinct units with at least one formal practice; repeats of the
  // same unit do not increase it. Y: all units of the layer.
  const practiced = layer.units.filter(
    (u) => (counts.get(u.unit_id) ?? 0) > 0).length;
  if (direct) {
    const total = layer.units.reduce((n, u) => n + u.question_count, 0);
    return (
      <div className="layer-block">
        <button type="button" className="layer-toggle capsule-card"
                disabled={opening || layer.units.length === 0}
                aria-label={`练习 ${label}${layer.question_type_label ? ` ${layer.question_type_label}` : ""}（共 ${total} 题）`}
                onClick={() => onOpenLayer(layer)}>
          <span className="layer-label">{label}</span>
          {layer.question_type_label ? (
            <span className="layer-type">{layer.question_type_label}</span>
          ) : null}
          <span className="layer-meta">
            共 {total} 题 · 已练习
            <span className="layer-progress">{practiced}/{layer.units.length}</span>
          </span>
          <span className="unit-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                 stroke="currentColor" strokeWidth="1.8"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className="layer-block">
      <button type="button" className="layer-toggle capsule-card"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}>
        <span className="layer-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="layer-label">{label}</span>
        {layer.question_type_label ? (
          <span className="layer-type">{layer.question_type_label}</span>
        ) : null}
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
