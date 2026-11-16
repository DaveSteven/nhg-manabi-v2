/**
 * Normalized API error handling.
 *
 * The backend currently emits three detail shapes (verified against
 * backend/app/api/{content,practice}.py):
 * 1. domain errors: {"detail": {"code", "message", ...extras}}
 *    e.g. active_session_exists (+active_session_id),
 *    draft_version_conflict (+current_row_version), unit_locked.
 * 2. plain-string details: {"detail": "..."} (auth failures,
 *    "no active practice", content 404s).
 * 3. FastAPI body-validation failures: {"detail": [{type, loc, msg, ...}]}.
 *
 * Everything surfaces as ApiError with a machine code; the UI maps codes
 * to states, never parses raw response bodies outside app/api.
 */
export type ApiErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable"
  | "server_error"
  | "network_error"
  | (string & {});

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** Extra fields from domain errors (active_session_id, current_row_version, …). */
  readonly details: Record<string, unknown>;

  constructor(status: number, code: ApiErrorCode, message: string,
              details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function statusFallbackCode(status: number): ApiErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "unprocessable";
  return "server_error";
}

export function normalizeErrorBody(
  status: number,
  body: unknown,
): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;

  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        const item = d as { loc?: unknown[]; msg?: string };
        const path = Array.isArray(item.loc)
          ? item.loc.filter((p) => p !== "body").join(".")
          : "";
        return path ? `${path}: ${item.msg ?? "invalid"}` : (item.msg ?? "invalid");
      })
      .join("; ");
    return new ApiError(status, "validation_error", parts || "invalid request");
  }

  if (typeof detail === "string") {
    return new ApiError(
      status,
      statusFallbackCode(status),
      detail,
    );
  }

  if (detail && typeof detail === "object") {
    const d = detail as { code?: string; message?: string } & Record<string, unknown>;
    const { code, message, ...extras } = d;
    return new ApiError(
      status,
      code ?? statusFallbackCode(status),
      message ?? "request failed",
      extras,
    );
  }

  return new ApiError(status, statusFallbackCode(status), "request failed");
}

export function networkError(cause: unknown): ApiError {
  return new ApiError(0, "network_error",
    cause instanceof Error ? cause.message : "network error");
}
