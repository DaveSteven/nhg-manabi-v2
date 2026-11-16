import { API_BASE } from "./env";
import { getBearerToken } from "./authToken";
import { ApiError, networkError, normalizeErrorBody } from "./errors";

export interface ApiRequest {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
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

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: request.method ?? "GET",
      headers,
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
      signal: request.signal,
    });
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
