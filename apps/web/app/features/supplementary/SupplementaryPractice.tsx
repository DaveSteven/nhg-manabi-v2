import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { FeedbackMode } from "../../api/dto/practice";
import { SUPPLEMENTARY_SUBJECTS, type Lesson,
         type SupplementarySubject } from "../../api/dto/supplementary";
import { describeLoadError } from "../../api/errors";
import { Breadcrumb } from "../../components/Breadcrumb";
import { useNavSection } from "../../components/TopNav";
import { useLevel } from "../auth/useLevel";
import { useLessons, useStartLesson } from "./useSupplementary";

const SUBJECT_LABEL: Record<SupplementarySubject, string> = {
  kanji: "汉字", vocabulary: "词汇", grammar: "语法",
};

function isSubject(v: string | null): v is SupplementarySubject {
  return SUPPLEMENTARY_SUBJECTS.some((s) => s === v);
}

/** One-line state of a lesson from the caller's formal answers. */
export function lessonStatus(l: Lesson): string {
  if (l.answered === 0) return "未练习";
  const done = l.answered >= l.question_count;
  const tail = l.wrong > 0 ? ` · 仍错 ${l.wrong}` : "";
  return `${done ? "已做完" : `已做 ${l.answered}/${l.question_count}`}${tail}`;
}

/**
 * 扩展练习 `/study/supplementary` (ADR-0030): level (follows the header
 * selector) → subject tab → lesson. Independent from 专项练习 sampling and
 * from 历年试卷: a lesson is a fixed ordered set of single-question Units.
 * Starting one replaces the in-progress practice (ADR-0016, no dialog).
 */
export function SupplementaryView() {
  useNavSection("topic");
  const navigate = useNavigate();
  const { level } = useLevel();
  const [params, setParams] = useSearchParams();
  const [feedback, setFeedback] = useState<FeedbackMode>("immediate");
  const query = useLessons(level);
  const subjects = query.data?.subjects ?? [];

  const requested = params.get("subject");
  const subject = isSubject(requested) && subjects.some((s) => s.subject === requested)
    ? requested
    : (subjects[0]?.subject ?? null);
  const lessons = useMemo(
    () => subjects.find((s) => s.subject === subject)?.lessons ?? [],
    [subjects, subject]);

  const start = useStartLesson((s) =>
    navigate(`/study/practice/${encodeURIComponent(s.id)}`));

  return (
    <section aria-label="扩展练习" className="topic-page supplementary-page">
      <Breadcrumb items={[{ label: "专项练习", to: "/study/practice" },
                          { label: "扩展练习" }]} />
      <h1>扩展练习</h1>
      <p className="text-aux">
        按课练习汉字、词汇、语法基础题；不计入专项练习的抽题和「我的学习」统计。
      </p>

      {level === null ? (
        <p role="status">请先登录，再选择备考等级。</p>
      ) : query.isPending ? (
        <p role="status">课程加载中…</p>
      ) : query.error ? (
        <p role={query.error.status === 401 ? "status" : "alert"}>
          {describeLoadError(query.error, "扩展练习")}
        </p>
      ) : subjects.length === 0 ? (
        <p>暂无 {level} 的扩展练习。</p>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="科目">
            {subjects.map((s) => (
              <button key={s.subject} type="button" role="tab"
                      aria-selected={s.subject === subject}
                      onClick={() => setParams({ subject: s.subject }, { replace: true })}>
                {SUBJECT_LABEL[s.subject]}
              </button>
            ))}
          </div>

          <div className="topic-field" role="radiogroup" aria-label="反馈方式">
            <span className="topic-field-label">反馈方式</span>
            <label className="topic-feedback-option">
              <input type="radio" name="supp-feedback" checked={feedback === "immediate"}
                     onChange={() => setFeedback("immediate")} />
              即时反馈（提交后看答案）
            </label>
            <label className="topic-feedback-option">
              <input type="radio" name="supp-feedback" checked={feedback === "end"}
                     onChange={() => setFeedback("end")} />
              统一反馈（结束后总结）
            </label>
          </div>

          <ul className="lesson-grid" aria-label="课程">
            {lessons.map((l) => (
              <li key={l.exam_id}>
                <button type="button" className="card lesson-card"
                        disabled={start.isPending}
                        aria-label={`开始第 ${l.lesson} 课`}
                        onClick={() => start.mutate({ exam_id: l.exam_id,
                                                      feedback_mode: feedback })}>
                  <span className="lesson-name">第 {l.lesson} 课</span>
                  <span className="lesson-meta">
                    {l.question_count} 题 · {lessonStatus(l)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {start.error ? (
            <p role="alert">
              {start.error.code === "lesson_not_found"
                ? "这一课暂时不可用，请换一课。"
                : `无法开始练习：${start.error.message}`}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
