import { z } from "zod";
import { apiFetch } from "../client";
import { DtoParseError, parseDto } from "../dto/exam";

/**
 * Student account endpoints (ADR-0011), pinned to
 * backend/app/api/auth_student.py. strictObject so contract drift
 * surfaces as parse errors. Field-level registration/profile errors come
 * back as 400 {"detail":{field,message}} — ApiError.details carries them
 * (see fieldErrorFrom).
 */

export const JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;
export type JlptLevel = (typeof JLPT_LEVELS)[number];

export const UserProfileSchema = z.strictObject({
  id: z.string(),
  /** null for V1-migrated accounts that never had an email (ADR-0029). */
  email: z.string().nullable(),
  username: z.string().nullable(),
  display_name: z.string(),
  current_level: z.enum(JLPT_LEVELS),
  /** Fixed-set avatar id; null = default solid-colour avatar. */
  avatar: z.string().nullable(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

const LoginResponseSchema = z.strictObject({
  token: z.string(),
  expires_at: z.string(),
  user: UserProfileSchema,
});

const MeResponseSchema = UserProfileSchema.extend({
  activated: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

const StatusSchema = z.strictObject({ status: z.string() });

export interface RegisterInput {
  email: string;
  password: string;
  display_name?: string;
}

/** Extract the field-level error detail from a normalized ApiError, if any. */
export function fieldErrorFrom(err: unknown): { field: string; message: string } | null {
  if (err instanceof Error && err.name === "ApiError") {
    const details = (err as { details?: Record<string, unknown> }).details;
    if (details && typeof details.field === "string" &&
        typeof details.message === "string") {
      return { field: details.field, message: details.message };
    }
  }
  return null;
}

function parse<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: { issues: unknown[] } } },
                  endpoint: string, payload: unknown): T {
  return parseDto(schema, endpoint, payload);
}

async function post<T>(path: string, body: unknown,
                       schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: { issues: unknown[] } } },
                       signal?: AbortSignal): Promise<T> {
  const raw = await apiFetch(path, { method: "POST", body, signal });
  return parse(schema, path, raw);
}

export async function registerAccount(input: RegisterInput,
                                      signal?: AbortSignal): Promise<void> {
  await post("/api/auth/register", {
    email: input.email,
    password: input.password,
    display_name: input.display_name ?? null,
  }, StatusSchema, signal);
}

export interface LoginResult {
  token: string;
  user: UserProfile;
}

/** `identifier` is an email or a username (ADR-0029). */
export async function loginAccount(identifier: string, password: string,
                                   signal?: AbortSignal): Promise<LoginResult> {
  const data = await post("/api/auth/login", { identifier, password },
                          LoginResponseSchema, signal);
  return { token: data.token, user: data.user };
}

export async function logoutAccount(signal?: AbortSignal): Promise<void> {
  await post("/api/auth/logout", null, StatusSchema, signal);
}

export async function verifyEmail(token: string,
                                  signal?: AbortSignal): Promise<"ok" | "already"> {
  const data = await post("/api/auth/verify-email", { token }, StatusSchema,
                          signal);
  return data.status === "already" ? "already" : "ok";
}

export async function resendVerification(email: string,
                                         signal?: AbortSignal): Promise<void> {
  await post("/api/auth/resend-verification", { email }, StatusSchema, signal);
}

export async function forgotPassword(email: string,
                                     signal?: AbortSignal): Promise<void> {
  await post("/api/auth/forgot-password", { email }, StatusSchema, signal);
}

export async function resetPassword(token: string, password: string,
                                    signal?: AbortSignal): Promise<void> {
  await post("/api/auth/reset-password", { token, password }, StatusSchema,
             signal);
}

export async function getMe(signal?: AbortSignal): Promise<MeResponse> {
  const raw = await apiFetch("/api/me", { signal });
  return parse(MeResponseSchema, "/api/me", raw);
}

export async function updateMe(patch: { display_name?: string;
                                        current_level?: JlptLevel;
                                        /** null resets to the default avatar */
                                        avatar?: string | null },
                               signal?: AbortSignal): Promise<MeResponse> {
  const raw = await apiFetch("/api/me", { method: "PATCH", body: patch, signal });
  return parse(MeResponseSchema, "/api/me", raw);
}

export { DtoParseError };
