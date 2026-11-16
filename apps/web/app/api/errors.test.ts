import { describe, expect, it } from "vitest";
import { ApiError, normalizeErrorBody } from "./errors";

describe("normalizeErrorBody", () => {
  it("normalizes domain dict detail with extras", () => {
    const err = normalizeErrorBody(409, {
      detail: {
        code: "active_session_exists",
        message: "an active practice session already exists",
        active_session_id: "abc",
      },
    });
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("active_session_exists");
    expect(err.message).toContain("active practice session");
    expect(err.details.active_session_id).toBe("abc");
  });

  it("normalizes draft version conflict extras", () => {
    const err = normalizeErrorBody(409, {
      detail: {
        code: "draft_version_conflict",
        message: "draft was changed by another request",
        current_row_version: 7,
      },
    });
    expect(err.code).toBe("draft_version_conflict");
    expect(err.details.current_row_version).toBe(7);
  });

  it("normalizes plain-string detail with status-derived code", () => {
    expect(normalizeErrorBody(404, { detail: "no active practice" }).code)
      .toBe("not_found");
    expect(normalizeErrorBody(401, { detail: "bearer token required" }).code)
      .toBe("unauthorized");
    expect(normalizeErrorBody(404, { detail: "exam not published" }).message)
      .toBe("exam not published");
  });

  it("normalizes FastAPI list-shaped validation detail", () => {
    const err = normalizeErrorBody(422, {
      detail: [
        { type: "missing", loc: ["body", "feedback_mode"], msg: "Field required" },
        { type: "value_error", loc: ["body", "units"], msg: "too few units" },
      ],
    });
    expect(err.code).toBe("validation_error");
    expect(err.message).toContain("feedback_mode: Field required");
    expect(err.message).toContain("units: too few units");
  });

  it("falls back to status-derived codes for unknown bodies", () => {
    expect(normalizeErrorBody(500, null).code).toBe("server_error");
    expect(normalizeErrorBody(409, null).code).toBe("conflict");
    expect(normalizeErrorBody(404, { detail: null }).code).toBe("not_found");
  });
});
