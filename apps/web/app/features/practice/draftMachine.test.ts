import { describe, expect, it } from "vitest";
import {
  answersForUnit,
  collectAnswers,
  draftReducer,
  initialQuestionState,
  displayOptionId,
  type DraftMachineState,
} from "./draftMachine";

function state(): DraftMachineState {
  return { questions: {} };
}
function withQ(s = state(), id = "q1") {
  return draftReducer(s, { type: "registered", questionId: id });
}

function run(s: DraftMachineState, action: Parameters<typeof draftReducer>[1]) {
  return draftReducer(s, action);
}

describe("draftMachine transition matrix", () => {
  it("registers questions idempotently", () => {
    const s = withQ(state());
    const s2 = run(s, { type: "registered", questionId: "q1" });
    expect(s2.questions.q1).toEqual(initialQuestionState());
  });

  it("select transitions idle → dirty and freezes on conflict", () => {
    let s = withQ(state());
    s = run(s, { type: "select", questionId: "q1", optionId: "o1" });
    expect(s.questions.q1!.status).toBe("dirty");
    expect(s.questions.q1!.pendingOptionId).toBe("o1");

    // conflict freezes further edits
    s = run(s, { type: "conflict", questionId: "q1", serverRowVersion: 5 });
    const frozen = run(s, { type: "select", questionId: "q1", optionId: "o2" });
    expect(frozen).toBe(s); // unchanged
  });

  it("clear transitions to dirty with null pending", () => {
    let s = withQ(state());
    s = run(s, { type: "select", questionId: "q1", optionId: "o1" });
    s = run(s, { type: "clear", questionId: "q1" });
    expect(s.questions.q1!.pendingOptionId).toBeNull();
    expect(s.questions.q1!.status).toBe("dirty");
  });

  it("saveStarted requires dirty; saveSucceeded acks version", () => {
    let s = withQ(state());
    s = run(s, { type: "saveStarted", questionId: "q1" }); // no-op when idle
    expect(s.questions.q1!.status).toBe("idle");
    s = run(s, { type: "select", questionId: "q1", optionId: "o1" });
    s = run(s, { type: "saveStarted", questionId: "q1" });
    expect(s.questions.q1!.status).toBe("saving");
    s = run(s, { type: "saveSucceeded", questionId: "q1", optionId: "o1", rowVersion: 3 });
    expect(s.questions.q1!.status).toBe("saved");
    expect(s.questions.q1!.rowVersion).toBe(3);
    expect(s.questions.q1!.pendingOptionId).toBeNull();
  });

  it("edit during saving → new local edit keeps dirty after ack", () => {
    let s = withQ(state());
    s = run(s, { type: "select", questionId: "q1", optionId: "o1" });
    s = run(s, { type: "saveStarted", questionId: "q1" });
    // user changes mind mid-save
    s = run(s, { type: "select", questionId: "q1", optionId: "o2" });
    expect(s.questions.q1!.status).toBe("dirty");
    // old save acks o1 → still dirty because pending o2 differs
    s = run(s, { type: "saveSucceeded", questionId: "q1", optionId: "o1", rowVersion: 2 });
    expect(s.questions.q1!.status).toBe("dirty");
    expect(s.questions.q1!.optionId).toBe("o1");
    expect(s.questions.q1!.pendingOptionId).toBe("o2");
  });

  it("saveFailed keeps the local selection and message", () => {
    let s = withQ(state());
    s = run(s, { type: "select", questionId: "q1", optionId: "o1" });
    s = run(s, { type: "saveFailed", questionId: "q1", message: "网络错误" });
    expect(s.questions.q1!.status).toBe("save_error");
    expect(s.questions.q1!.pendingOptionId).toBe("o1");
    expect(s.questions.q1!.errorMessage).toBe("网络错误");
  });

  it("conflict → adopt server → saved with server values", () => {
    let s = withQ(state());
    s = run(s, { type: "select", questionId: "q1", optionId: "o2" });
    s = run(s, { type: "conflict", questionId: "q1", serverRowVersion: 7 });
    expect(s.questions.q1!.status).toBe("conflict");
    s = run(s, { type: "conflictAdoptServer", questionId: "q1",
                 serverOptionId: "o1", serverRowVersion: 7 });
    expect(s.questions.q1!.status).toBe("saved");
    expect(s.questions.q1!.optionId).toBe("o1");
    expect(s.questions.q1!.rowVersion).toBe(7);
    expect(displayOptionId(s.questions.q1!)).toBe("o1");
  });

  it("conflict → overwrite → dirty carrying the fresh server version", () => {
    let s = withQ(state());
    s = run(s, { type: "select", questionId: "q1", optionId: "o2" });
    s = run(s, { type: "conflict", questionId: "q1", serverRowVersion: 7 });
    s = run(s, { type: "conflictOverwrite", questionId: "q1", serverRowVersion: 7 });
    expect(s.questions.q1!.status).toBe("dirty");
    expect(s.questions.q1!.rowVersion).toBe(7);
    expect(s.questions.q1!.pendingOptionId).toBe("o2");
  });

  it("hydrated marks server drafts as saved truth", () => {
    const s = run(state(), { type: "hydrated", drafts: [
      { questionId: "q1", optionId: "o1", rowVersion: 4 },
    ] });
    expect(s.questions.q1!.status).toBe("saved");
    expect(s.questions.q1!.rowVersion).toBe(4);
  });

  it("submitted locks pending edits but keeps last display value", () => {
    let s = withQ(state());
    s = run(s, { type: "select", questionId: "q1", optionId: "o1" });
    s = run(s, { type: "submitted", questionIds: ["q1"] });
    expect(s.questions.q1!.pendingOptionId).toBeNull();
    expect(displayOptionId(s.questions.q1!)).toBe("o1");
  });

  it("collectAnswers uses display values; null = explicit skip", () => {
    let s = state();
    for (const id of ["qa", "qb"]) s = run(s, { type: "registered", questionId: id });
    s = run(s, { type: "select", questionId: "qa", optionId: "oa" });
    const answers = collectAnswers(s.questions);
    expect(answers).toContainEqual({ question_id: "qa", chosen_option_id: "oa" });
    expect(answers).toContainEqual({ question_id: "qb", chosen_option_id: null });
  });
});

describe("answersForUnit", () => {
  it("drops answers of questions from a previously practiced unit", () => {
    const all = [
      { question_id: "u04-q01", chosen_option_id: "u04-q01-o3" },
      { question_id: "u05-q01", chosen_option_id: "u05-q01-o3" },
    ];
    expect(answersForUnit(all, ["u05-q01"])).toEqual([
      { question_id: "u05-q01", chosen_option_id: "u05-q01-o3" },
    ]);
  });
});
