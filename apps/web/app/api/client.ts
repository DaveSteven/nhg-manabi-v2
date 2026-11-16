import { API_BASE } from "./env";
import { getBearerToken } from "./authToken";
import { ApiError, networkError, normalizeErrorBody } from "./errors";

export interface ApiRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Abort bridging without passing the signal to fetch. Reason: in jsdom
 * test environments the AbortSignal comes from a different realm than the
 * fetch implementation (Node/undici), which rejects foreign signal
 * instances. Racing the abort keeps identical observable behavior —
 * AbortError on abort — and is realm-safe. The underlying request may
 * continue briefly after abort; its result is discarded.
 */
function fetchWithAbort(url: string, init: RequestInit,
                        signal: AbortSignal | undefined): Promise<Response> {
  if (!signal) return fetch(url, init);
  let abortReject: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    abortReject = () =>
      reject(new DOMException("The operation was aborted.", "AbortError"));
  });
  const onAbort = () => abortReject!();
  signal.addEventListener("abort", onAbort, { once: true });
  return Promise.race([
    fetch(url, init).finally(() => signal.removeEventListener("abort", onAbort)),
    aborted,
  ]);
}

/**
 * Thin JSON fetch wrapper. Non-2xx responses always throw a normalized
 * ApiError; 2xx returns the parsed JSON body (or null when empty).
 * Endpoint modules (app/api/endpoints/*) own path construction and DTO
 * parsing — snake_case stops at this boundary.
 */
export async function apiFetch(path: string, request: ApiRequest = {}): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getBearerToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (request.body !== undefined) headers["Content-Type"] = "application/json";

  // Same-origin by default: resolve relative paths against the current
  // origin (Vite dev proxy / production static-host proxy / tests).
  const base = API_BASE ||
    (typeof window !== "undefined" ? window.location.origin : "");

  let response: Response;
  try {
    response = await fetchWithAbort(`${base}${path}`, {
      method: request.method ?? "GET",
      headers,
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
    }, request.signal);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw networkError(cause);
  }

  let payload: unknown = null;
  const hasBody = response.status !== 204;
  if (hasBody) {
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (!response.ok) {
          throw new ApiError(response.status, "server_error",
            "unparseable error response");
        }
        throw new ApiError(response.status, "server_error",
          "response was not valid JSON");
      }
    }
  }

  if (!response.ok) throw normalizeErrorBody(response.status, payload);
  return payload;
}
