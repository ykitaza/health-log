"""アプリ（apps/words）と同じテストのデータ（testdata/words）で、正規化・似た表現・間隔・優先度・初期の行を確かめる。"""

import json
from datetime import date, datetime
from pathlib import Path

import pytest

from words.domain import model as m
from words.domain import schedule as sch
from words.domain.catalog import SEED_SOURCES, SEED_TAGS, WORDS_NAMESPACE, expression_tag_id
from words.domain.normalize import search_key
from words.domain.similarity import SIMILAR_THRESHOLD, is_similar, jaccard

TESTDATA = Path(__file__).parents[3] / "testdata" / "words"


def load(name: str) -> dict:
    return json.loads((TESTDATA / name).read_text())


@pytest.mark.parametrize("case", load("search_key.json")["cases"])
def test_正規化(case):
    assert search_key(case["input"]) == case["expected"]


def test_似た表現のしきい値():
    assert load("similarity.json")["threshold"] == SIMILAR_THRESHOLD


@pytest.mark.parametrize("case", load("similarity.json")["cases"])
def test_似た表現(case):
    a, b = search_key(case["a"]), search_key(case["b"])
    assert round(jaccard(a, b), 6) == case["jaccard"]
    assert is_similar(a, b) == case["similar"]


def _schedule_dict(s: m.Schedule) -> dict:
    iso = lambda d: d.isoformat() if d else None  # noqa: E731
    return {"stage": s.stage.value if s.stage else None, "interval_days": s.interval_days, "due_on": iso(s.due_on),
            "last_reviewed_on": iso(s.last_reviewed_on), "success_streak": s.success_streak,
            "lapse_streak": s.lapse_streak, "review_count": s.review_count, "lapse_count": s.lapse_count,
            "use_count": s.use_count, "last_used_on": iso(s.last_used_on)}


@pytest.mark.parametrize("case", load("schedule.json")["cases"], ids=lambda c: c["name"])
def test_間隔(case):
    s = sch.enter_hand(m.Schedule(), date.fromisoformat(case["start"]))
    for step in case["steps"]:
        day = date.fromisoformat(step["day"])
        s = sch.apply_use(s, day) if step["event"] == "use" else sch.apply_recall(s, m.RecallResult(step["event"]), day)
        assert _schedule_dict(s) == step["expected"], step


@pytest.mark.parametrize("case", load("schedule.json")["business_day"])
def test_日付の区切りは午前4時(case):
    assert sch.business_day(datetime.fromisoformat(case["at"].replace("Z", "+00:00"))).isoformat() == case["expected"]


def _hand(rows: list[dict]) -> list[m.Expression]:
    def day(v):
        return date.fromisoformat(v) if v else None

    return [m.Expression(
        r["id"], r["id"], r["id"], m.Place.HAND,
        m.Schedule(stage=m.Stage.UNDERSTOOD, interval_days=r["interval_days"], due_on=day(r["due_on"]),
                   last_reviewed_on=day(r["last_reviewed_on"])),
        hand_since=day(r["hand_since"]), star=r.get("star", False), usefulness=r.get("usefulness"),
        usefulness_until=day(r.get("usefulness_until"))) for r in rows]


def test_優先度と一度に見せるもの():
    data = load("priority.json")
    today = date.fromisoformat(data["today"])
    hand = _hand(data["hand"])
    for e, expected in zip(hand, data["expected_each"]):
        assert {"id": e.id, "risk": round(sch.risk(e, today), 6), "usefulness": sch.usefulness(e, today),
                "priority": round(sch.priority(e, today), 6)} == expected
    queue = lambda h: [{"id": q.expression.id, "priority": q.priority, "due": q.due}  # noqa: E731
                       for q in sch.review_queue(h, today)]
    assert queue(hand) == data["expected_queue"]
    for case in data["queue_cases"]:
        assert queue([e for e in hand if e.id in case["hand_ids"]]) == case["expected"], case["name"]


def test_初期の行とつながりの_ID():
    data = load("catalog.json")
    assert data["namespace"] == str(WORDS_NAMESPACE)
    assert [{k: v for k, v in s.items() if k != "key"} for s in data["sources"]] == [
        {"id": s.id, "name": s.name, "icon_key": s.icon_key, "sort_order": s.sort_order} for s in SEED_SOURCES]
    assert [{k: v for k, v in t.items() if k != "key"} for t in data["tags"]] == [
        {"id": t.id, "kind": t.kind.value, "name": t.name, "sort_order": t.sort_order} for t in SEED_TAGS]
    for case in data["expression_tag_ids"]:
        assert expression_tag_id(case["expression_id"], case["tag_id"]) == case["expected"]
