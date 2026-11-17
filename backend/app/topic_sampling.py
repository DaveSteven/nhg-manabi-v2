"""Smart random sampling for 专项练习 (business-rules「智能随机抽样」).

Pure functions, no DB: the caller supplies candidate Units (complete,
current-release, one question type, one level) and the caller's formal
practice history per Unit, so the policy is unit-testable and the history
source stays the immutable submitted-answer tables (never drafts).

Policy (parameters are tunable, recorded in the devlog, not product rules):
- soft quota: ~75% unseen Units, ~25% reviewed Units; either side falls back
  to the other when it cannot fill its share (never fewer than requested
  while candidates remain);
- review weight blends smoothed recent-wrong rate, staleness and low
  frequency; smoothing keeps few-sample accuracy from dominating and the
  weighted draw keeps randomness (never "always the hardest");
- whole Units only: callers pass Units, questions are never split.
"""
import math
import random
from dataclasses import dataclass
from datetime import datetime

REVIEW_SHARE = 0.25
STALE_DAYS_CAP = 30.0


@dataclass(frozen=True)
class UnitHistory:
    submitted_count: int          # formally submitted session units
    answered: int                 # questions whose LATEST valid answer exists
    latest_wrong: int             # of those, latest valid answer is wrong
    last_submitted_at: datetime | None


@dataclass(frozen=True)
class Candidate:
    release_id: str
    unit_id: str
    exam_id: str
    history: UnitHistory | None = None


def review_weight(h: UnitHistory, now: datetime) -> float:
    wrong_rate = (h.latest_wrong + 0.5) / (h.answered + 1.0)  # smoothed
    if h.last_submitted_at is None:
        staleness = 1.0
    else:
        days = max((now - h.last_submitted_at).total_seconds() / 86400.0, 0.0)
        staleness = min(days / STALE_DAYS_CAP, 1.0)
    low_freq = 1.0 / (1.0 + h.submitted_count)
    return 0.2 + 2.0 * wrong_rate + 0.7 * staleness + 0.5 * low_freq


def _weighted_sample(items: list[Candidate], weights: list[float], k: int,
                     rng: random.Random) -> list[Candidate]:
    """Weighted sampling without replacement (Efraimidis–Spirakis)."""
    if k <= 0 or not items:
        return []
    keyed = sorted(
        ((math.log(max(rng.random(), 1e-12)) / w, c)
         for c, w in zip(items, weights)),
        key=lambda t: t[0], reverse=True)
    return [c for _, c in keyed[:k]]


def select_units(candidates: list[Candidate], count: int, now: datetime,
                 rng: random.Random | None = None) -> list[Candidate]:
    rng = rng or random.Random()
    if count <= 0 or not candidates:
        return []
    count = min(count, len(candidates))
    unseen = [c for c in candidates
              if c.history is None or c.history.submitted_count == 0]
    seen = [c for c in candidates if c not in unseen]

    n_review = min(round(count * REVIEW_SHARE), len(seen))
    n_new = min(count - n_review, len(unseen))
    # new pool short → the review pool covers the rest (and vice versa).
    n_review = min(count - n_new, len(seen))

    picked = _weighted_sample(
        seen, [review_weight(c.history, now) for c in seen], n_review, rng)
    picked += rng.sample(unseen, n_new)
    rng.shuffle(picked)
    return picked


def select_wrong_units(candidates: list[Candidate],
                       wrong_counts: dict[tuple[str, str], int], count: int,
                       rng: random.Random | None = None) -> list[Candidate]:
    """「只复习最近仍错」: whole Units that still hold at least one question
    whose latest valid answer is wrong. Units with more still-wrong
    questions are likelier but never certain (weighted, not top-N), and the
    pool is never padded with units the user has not got wrong."""
    rng = rng or random.Random()
    pool = [c for c in candidates if wrong_counts.get((c.release_id, c.unit_id), 0) > 0]
    count = min(count, len(pool))
    if count <= 0:
        return []
    weights = [float(wrong_counts[(c.release_id, c.unit_id)]) for c in pool]
    return _weighted_sample(pool, weights, count, rng)
