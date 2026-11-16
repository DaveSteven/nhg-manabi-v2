import { describe, expect, it } from "vitest";
import {
  CreateSessionResponseSchema,
  FeedbackPayloadSchema,
  FinishResponseSchema,
  PracticeSessionSchema,
  ResultsResponseSchema,
  SubmitResultSchema,
} from "./practice";
import { parseDto } from "./exam";

/** Fixtures mirror practice.py payloads (M2.1 Task 04–08 wire shapes). */
const session = {
  id: "11111111-1111-4111-8111-111111111111",
  mode: "practice",
  feedback_mode: "immediate",
  state: "in_progress",
  config: {
    requested_units: [
      { release_id: "r-uuid", unit_id: "u01" },
    ],
  },
  version: 1,
  created_at: "2026-11-16T00:00:00+00:00",
  ended_at: null,
  units: [
    {
      id: "su-1",
      release_id: "r-uuid",
      unit_id: "u01",
      position: 1,
      state: "pending",
      submitted_at: null,
    },
    {
      id: "su-2",
      release_id: "r-uuid",
      unit_id: "u02",
      position: 2,
      state: "submitted",
      submitted_at: "2026-11-16T00:01:00+00:00",
    },
  ],
};

const results = {
  correct_count: 3,
  wrong_count: 2,
  skipped_count: 1,
  total_count: 6,
  score_rate: 0.5,
  answered_accuracy: 0.6,
  scoring_method: "all_questions",
  scoring_version: "1",
  finished_at: "2026-11-16T00:10:00+00:00",
  questions: [
    {
      unit_id: "u01",
      unit_position: 1,
      question_id: "q01",
      question_position: 1,
      printed_number: "35",
      chosen_option_id: "q01-o2",
      correct_option_id: "q01-o2",
      is_correct: true,
      skipped: false,
    },
    {
      unit_id: "u01",
      unit_position: 1,
      question_id: "q02",
      question_position: 2,
      printed_number: "36",
      chosen_option_id: null,
      correct_option_id: "q02-o1",
      is_correct: null,
      skipped: true,
    },
  ],
};

describe("practice DTOs", () => {
  it("accepts the session payload (create/get/current/finish)", () => {
    const parsed = parseDto(PracticeSessionSchema, "GET session", session);
    expect(parsed.units[1]?.state).toBe("submitted");
  });

  it("accepts units_meta only on the create response", () => {
    const created = {
      ...session,
      units_meta: [{ release_id: "r-uuid", unit_id: "u01", layer_id: "ly-1",
                     question_type_id: "grammar_cloze", exam_id: "exam",
                     question_count: 5 }],
    };
    expect(() =>
      parseDto(CreateSessionResponseSchema, "POST sessions", created)).not.toThrow();
    // GET responses must NOT carry units_meta (strictObject rejects it).
    expect(() =>
      parseDto(PracticeSessionSchema, "GET session", created)).toThrow();
  });

  it("accepts submit result with optional feedback", () => {
    const submitted = {
      session_unit_id: "su-1",
      unit_id: "u01",
      release_id: "r-uuid",
      state: "submitted",
      answered_count: 4,
      skipped_count: 1,
      idempotent: false,
      feedback: {
        unit_id: "u01",
        release_id: "r-uuid",
        feedback_mode: "immediate",
        questions: [{
          question_id: "q02",
          position: 2,
          printed_number: "36",
          chosen_option_id: null,
          correct_option_id: null,
          is_correct: null,
          skipped: true,
          explanations: [],
        }],
        unit_explanations: [{ kind: "translation", language: "zh-CN",
                              content: {} }],
      },
    };
    const parsed = parseDto(SubmitResultSchema, "POST submit", submitted);
    expect(parsed.feedback?.questions[0]?.skipped).toBe(true);
    // end-mode submit carries no feedback key at all:
    const { feedback: _omit, ...noFeedback } = submitted;
    expect(() => parseDto(SubmitResultSchema, "POST submit", noFeedback))
      .not.toThrow();
  });

  it("accepts the results payload with three-state per-question review", () => {
    const parsed = parseDto(ResultsResponseSchema, "GET results",
      { ...results, session_id: session.id });
    expect(parsed.correct_count + parsed.wrong_count + parsed.skipped_count)
      .toBe(parsed.total_count);
    expect(parsed.questions[1]?.is_correct).toBeNull();
  });

  it("accepts finish dual outcome: results or ended_early without results", () => {
    const completed = { ...session, state: "completed", ended_at: "x",
                        results, idempotent: false };
    const finished = parseDto(FinishResponseSchema, "POST finish", completed);
    expect(finished.results?.score_rate).toBe(0.5);

    const early = { ...session, state: "ended_early", idempotent: true };
    const earlyParsed = parseDto(FinishResponseSchema, "POST finish", early);
    expect(earlyParsed.results).toBeUndefined();
  });

  it("accepts any count shapes — identity is a view model concern", () => {
    // parse validates shape only; the correct+wrong+skipped=total identity
    // is enforced by resultsModel (Commit 4) and the backend CHECK.
    const broken = { ...results, correct_count: 4 };
    expect(() => parseDto(ResultsResponseSchema, "GET results",
      { ...broken, session_id: "s" })).not.toThrow();
  });

  it("feedback payload requires feedback_mode (same shape in submit and GET)", () => {
    const base = {
      unit_id: "u01", release_id: "r-uuid", questions: [],
      unit_explanations: [],
    };
    expect(() => parseDto(FeedbackPayloadSchema, "GET feedback",
      { ...base, feedback_mode: "immediate" })).not.toThrow();
    expect(() => parseDto(FeedbackPayloadSchema, "GET feedback", base)).toThrow();
  });

  it("accepts the feedback payload shape", () => {
    const feedback = {
      unit_id: "u01",
      release_id: "r-uuid",
      feedback_mode: "end",
      questions: [{
        question_id: "q01",
        position: 1,
        printed_number: null,
        chosen_option_id: "q01-o1",
        correct_option_id: "q01-o2",
        is_correct: false,
        skipped: false,
        explanations: [{ kind: "analysis", language: "zh-CN", content: {} }],
      }],
      unit_explanations: [],
    };
    expect(() => parseDto(FeedbackPayloadSchema, "GET feedback", feedback))
      .not.toThrow();
  });
});
