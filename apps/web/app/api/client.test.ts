import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./client";
import { ApiError } from "./errors";
import { setDevUserToken } from "./authToken";

function mockFetchOnce(status: number, body: string | null,
                       contentType = "application/json") {
  const fn = vi.fn().mockResolvedValue(new Response(body, {
    status,
    headers: { "content-type": contentType },
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("apiFetch", () => {
  it("sends JSON body and content type, returns parsed payload", async () => {
    const fn = mockFetchOnce(200, JSON.stringify({ ok: 1 }));
    const out = await apiFetch("/api/x", { method: "POST", body: { a: "b" } });
    expect(out).toEqual({ ok: 1 });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/x");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ a: "b" }));
  });

  it("attaches bearer token when set", async () => {
    vi.stubEnv("VITE_DEV_USER_TOKEN",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const fn = mockFetchOnce(200, "null");
    await apiFetch("/api/exams");
    const [, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
  });

  it("throws normalized ApiError for dict-detail 409", async () => {
    mockFetchOnce(409, JSON.stringify({
      detail: { code: "active_session_exists", message: "conflict",
                active_session_id: "s1" },
    }));
    const err = await apiFetch("/api/practice/sessions").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("active_session_exists");
    expect((err as ApiError).details.active_session_id).toBe("s1");
  });

  it("throws validation_error for list-shaped 422", async () => {
    mockFetchOnce(422, JSON.stringify({
      detail: [{ type: "missing", loc: ["body", "units"], msg: "Field required" }],
    }));
    const err = await apiFetch("/api/practice/sessions", { method: "POST" })
      .catch((e) => e);
    expect((err as ApiError).code).toBe("validation_error");
  });

  it("maps network failures to network_error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
    const err = await apiFetch("/api/x").catch((e) => e);
    expect((err as ApiError).code).toBe("network_error");
  });

  it("returns null for 204 responses", async () => {
    mockFetchOnce(204, null);
    expect(await apiFetch("/api/x", { method: "DELETE" })).toBeNull();
  });
});
