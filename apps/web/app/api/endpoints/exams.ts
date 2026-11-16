import { apiFetch } from "../client";
import { parseDto } from "../dto/exam";
import {
  ExamOutlineSchema,
  ExamSummarySchema,
  LayerCatalogEntrySchema,
  type ExamOutline,
  type ExamSummary,
  type LayerCatalogEntry,
} from "../dto/exam";
import { PublicUnitSchema, type PublicUnit } from "../dto/unit";

export function getExams(signal?: AbortSignal): Promise<ExamSummary[]> {
  return apiFetch("/api/exams", { signal }).then((p) =>
    parseDto(ExamSummarySchema.array(), "GET /api/exams", p));
}

export function getExamOutline(examId: string, signal?: AbortSignal): Promise<ExamOutline> {
  return apiFetch(`/api/exams/${encodeURIComponent(examId)}`, { signal })
    .then((p) => parseDto(ExamOutlineSchema, `GET /api/exams/${examId}`, p));
}

export function getExamLayers(examId: string, signal?: AbortSignal): Promise<LayerCatalogEntry[]> {
  return apiFetch(`/api/exams/${encodeURIComponent(examId)}/layers`, { signal })
    .then((p) => parseDto(LayerCatalogEntrySchema.array(),
      `GET /api/exams/${examId}/layers`, p));
}

export function getExamUnit(examId: string, unitId: string,
                            signal?: AbortSignal): Promise<PublicUnit> {
  return apiFetch(
    `/api/exams/${encodeURIComponent(examId)}/units/${encodeURIComponent(unitId)}`,
    { signal })
    .then((p) => parseDto(PublicUnitSchema, `GET unit ${unitId}`, p));
}

/** Fixed-release fetch: the only correct way to load a session's unit. */
export function getReleaseUnit(releaseId: string, unitId: string,
                               signal?: AbortSignal): Promise<PublicUnit> {
  return apiFetch(
    `/api/releases/${encodeURIComponent(releaseId)}/units/${encodeURIComponent(unitId)}`,
    { signal })
    .then((p) => parseDto(PublicUnitSchema, `GET release unit ${unitId}`, p));
}

/**
 * Media URL for an asset referenced by a unit's payload. Frontend locates
 * media by (release_id, asset_id) only — never by storage path
 * (docs/development/M2.2-frontend-implementation.md §6).
 */
export function releaseAssetUrl(releaseId: string, assetId: string): string {
  return `/api/releases/${encodeURIComponent(releaseId)}/assets/${encodeURIComponent(assetId)}`;
}
