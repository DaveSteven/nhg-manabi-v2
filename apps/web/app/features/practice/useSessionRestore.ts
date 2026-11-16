import { useQuery } from "@tanstack/react-query";
import type { PracticeSession } from "../../api/dto/practice";
import type { PublicUnit } from "../../api/dto/unit";
import { ApiError } from "../../api/errors";
import { getReleaseUnit } from "../../api/endpoints/exams";
import { getDrafts, getSession } from "../../api/endpoints/sessions";

export interface RestoredUnit {
  sessionUnitId: string;
  unit: PublicUnit;
}

export interface SessionBundle {
  session: PracticeSession;
  units: RestoredUnit[];
  drafts: { session_unit_id: string; question_id: string;
            chosen_option_id: string | null; row_version: number }[];
}

/**
 * Restore order per M2.2 §7.1: own session → units pinned to their FIXED
 * release (never the exam's current release) → server drafts. localStorage
 * retry records are merged by the caller only when newer than the server
 * draft by version.
 */
export function useSessionRestore(sessionId: string | undefined) {
  return useQuery<SessionBundle, ApiError>({
    queryKey: ["session-bundle", sessionId],
    queryFn: async ({ signal }) => {
      const session = await getSession(sessionId!, signal);
      const [units, drafts] = await Promise.all([
        Promise.all(session.units.map(async (su) => ({
          sessionUnitId: su.id,
          unit: await getReleaseUnit(su.release_id, su.unit_id, signal),
        }))),
        getDrafts(sessionId!, signal),
      ]);
      return {
        session,
        units: units.sort((a, b) => {
          const pa = session.units.find((u) => u.id === a.sessionUnitId)!.position;
          const pb = session.units.find((u) => u.id === b.sessionUnitId)!.position;
          return pa - pb;
        }),
        drafts: drafts.drafts,
      };
    },
    enabled: sessionId !== undefined,
    retry: 0,
    staleTime: 0,
  });
}
