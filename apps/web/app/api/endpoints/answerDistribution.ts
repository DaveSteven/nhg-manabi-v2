import { apiFetch } from "../client";
import { parseDto } from "../dto/exam";
import { AnswerDistributionSchema, type AnswerDistribution } from "../dto/answerDistribution";

export function getAnswerDistribution(signal?: AbortSignal): Promise<AnswerDistribution> {
  return apiFetch("/api/answer-distribution", { signal })
    .then((p) => parseDto(AnswerDistributionSchema, "GET answer-distribution", p));
}
