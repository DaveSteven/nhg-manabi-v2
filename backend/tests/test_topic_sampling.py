"""Pure sampling policy tests (no DB)."""
import random
from datetime import datetime, timedelta, timezone

from app.topic_sampling import (Candidate, UnitHistory, review_weight,
                                select_units)

NOW = datetime(2026, 11, 17, tzinfo=timezone.utc)


def cand(i, hist=None):
    return Candidate(release_id="r", unit_id=f"u{i}", exam_id=f"e{i}",
                     history=hist)


def seen(wrong=0, answered=4, n=1, days=1):
    return UnitHistory(submitted_count=n, answered=answered,
                       latest_wrong=wrong,
                       last_submitted_at=NOW - timedelta(days=days))


def test_empty_and_zero_count():
    assert select_units([], 3, NOW) == []
    assert select_units([cand(1)], 0, NOW) == []


def test_no_history_all_new_no_duplicates():
    cs = [cand(i) for i in range(20)]
    out = select_units(cs, 10, NOW, random.Random(1))
    assert len(out) == 10 and len({c.unit_id for c in out}) == 10


def test_quota_about_quarter_review_when_both_pools_big():
    cs = [cand(i) for i in range(20)] + [cand(100 + i, seen()) for i in range(20)]
    for s in range(20):
        out = select_units(cs, 8, NOW, random.Random(s))
        assert len(out) == 8
        assert sum(1 for c in out if c.history) == 2  # round(8*0.25)


def test_new_pool_short_falls_back_to_review():
    cs = [cand(1), cand(2)] + [cand(100 + i, seen()) for i in range(10)]
    out = select_units(cs, 6, NOW, random.Random(3))
    assert len(out) == 6
    assert sum(1 for c in out if c.history is None) == 2


def test_review_pool_short_falls_back_to_new():
    cs = [cand(i) for i in range(10)] + [cand(100, seen())]
    out = select_units(cs, 8, NOW, random.Random(3))
    assert len(out) == 8
    assert sum(1 for c in out if c.history) == 1  # only one reviewable


def test_count_larger_than_candidates_returns_all_once():
    cs = [cand(1), cand(2, seen())]
    out = select_units(cs, 9, NOW, random.Random(0))
    assert sorted(c.unit_id for c in out) == ["u1", "u2"]


def test_all_practised_still_selects():
    cs = [cand(i, seen()) for i in range(6)]
    assert len(select_units(cs, 4, NOW, random.Random(0))) == 4


def test_weight_prefers_wrong_and_stale_but_smooths_small_samples():
    wrong = seen(wrong=4, answered=4)
    right = seen(wrong=0, answered=4)
    assert review_weight(wrong, NOW) > review_weight(right, NOW)
    stale = seen(days=60)
    fresh = seen(days=0)
    assert review_weight(stale, NOW) > review_weight(fresh, NOW)
    one_wrong = seen(wrong=1, answered=1)
    many_wrong = seen(wrong=10, answered=10)
    assert review_weight(one_wrong, NOW) < review_weight(many_wrong, NOW)


def test_weighted_draw_is_not_deterministic_hardest_only():
    hard = cand(1, seen(wrong=4))
    easy = cand(2, seen(wrong=0, days=0))
    picks = set()
    # quota with 2 seen / 0 unseen and count=1: review pool only.
    for s in range(300):
        picks.add(select_units([hard, easy], 1, NOW, random.Random(s))[0].unit_id)
    assert picks == {"u1", "u2"}
