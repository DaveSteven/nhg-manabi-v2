import { Link } from "react-router";
import { useAuth } from "../auth/authStore";
import { formatClock, timeTone } from "./mockModel";
import { useCurrentMock, useServerCountdown } from "./useMock";

/** Slim reminder under the study header while a strict mock is running — the
 * mock keeps its own clock while the user practises (ADR-0020). */
export function MockBanner() {
  const auth = useAuth();
  const q = useCurrentMock(!!auth.user);
  const s = q.data && q.data.state === "in_progress" ? q.data : null;
  const active = s?.phases.find((p) => p.status === "active") ?? null;
  const left = useServerCountdown(active?.expires_at ?? null, s?.server_now,
                                  () => { void q.refetch(); });
  if (!s || !active) return null;
  return (
    <div className="mock-banner" role="status">
      <span>模拟考试进行中 · {s.level} · {active.title}</span>
      <span className={`mock-banner-clock tone-${left === null ? "normal" : timeTone(left)}`}>
        剩余 {left === null ? "--:--" : formatClock(left)}
      </span>
      <Link className="btn btn-primary btn-sm" to={`/mock/${encodeURIComponent(s.id)}`}>
        继续考试
      </Link>
    </div>
  );
}
