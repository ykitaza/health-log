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
from words.domain.stats import activity_stats

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
            "listened_at": s.listened_at, "listen_count": s.listen_count, "use_count": s.use_count,
            "last_used_on": iso(s.last_used_on)}


@pytest.mark.parametrize("case", load("schedule.json")["cases"], ids=lambda c: c["name"])
def test_間隔(case):
    s = sch.enter_hand(m.Schedule(), date.fromisoformat(case["start"]))
    for step in case["steps"]:
        if step["event"] == "use":
            s = sch.apply_use(s, date.fromisoformat(step["day"]))
        else:
            s = sch.apply_listen(s, step["at"])
        assert _schedule_dict(s) == step["expected"], step


@pytest.mark.parametrize("case", load("schedule.json")["business_day"])
def test_日付の区切りは午前4時(case):
    assert sch.business_day(datetime.fromisoformat(case["at"].replace("Z", "+00:00"))).isoformat() == case["expected"]


def _expression(r: dict) -> m.Expression:
    def day(v):
        return date.fromisoformat(v) if v else None

    place = m.Place(r.get("place", "hand"))
    return m.Expression(
        r["id"], r["id"], r["id"], place,
        m.Schedule(stage=m.Stage.UNDERSTOOD if place is m.Place.HAND else None, interval_days=r.get("interval_days", 1),
                   due_on=day(r.get("due_on")), listened_at=r.get("listened_at")),
        hand_since=day(r.get("hand_since")), star=r.get("star", False), usefulness=r.get("usefulness"),
        usefulness_until=day(r.get("usefulness_until")), created_at=r.get("created_at", "2026-10-01T00:00:00.000Z"))


def test_優先度と聞く順():
    data = load("listen_queue.json")
    today = date.fromisoformat(data["today"])
    expressions = [_expression(r) for r in data["expressions"]]
    hand = [e for e in expressions if e.place is m.Place.HAND]
    for e, expected in zip(hand, data["expected_each"]):
        assert {"id": e.id, "risk": round(sch.risk(e, today), 6), "usefulness": sch.usefulness(e, today),
                "priority": round(sch.priority(e, today), 6)} == expected
    for case in data["cases"]:
        got = [{"id": q.expression.id, "group": q.group, "priority": q.priority}
               for q in sch.listen_queue(expressions, today, case["limit"])]
        assert got == case["expected"], case["limit"]


def test_活動の記録():
    data = load("stats.json")

    def day(v):
        return date.fromisoformat(v) if v else None

    expressions = [m.Expression(r["id"], r["id"], r["id"], m.Place(r["place"]), source_id=r["source_id"],
                                created_at=r["created_at"], hand_since=day(r.get("hand_since")),
                                moved_at=r.get("moved_at")) for r in data["expressions"]]
    encounters = [m.Encounter(r["id"], r["expression_id"], created_at=r["created_at"]) for r in data["encounters"]]
    usages = [m.Usage(r["id"], r["expression_id"], day(r["used_on"])) for r in data["usages"]]
    listens = [m.ListenSession(r["id"], r["started_at"], day(r["listened_on"]), r["seconds"], r["items"])
               for r in data["listen_sessions"]]
    sources = [m.Source(s["id"], s["name"], "other", 0) for s in data["sources"]]
    for case in data["cases"]:
        got = activity_stats(expressions, encounters, usages, listens, sources, date.fromisoformat(data["today"]),
                             case["unit"], case["count"])
        assert got == case["expected"], case["unit"]


def test_初期の行とつながりの_ID():
    data = load("catalog.json")
    assert data["namespace"] == str(WORDS_NAMESPACE)
    assert [{k: v for k, v in s.items() if k != "key"} for s in data["sources"]] == [
        {"id": s.id, "name": s.name, "icon_key": s.icon_key, "sort_order": s.sort_order} for s in SEED_SOURCES]
    assert [{k: v for k, v in t.items() if k != "key"} for t in data["tags"]] == [
        {"id": t.id, "kind": t.kind.value, "name": t.name, "sort_order": t.sort_order} for t in SEED_TAGS]
    for case in data["expression_tag_ids"]:
        assert expression_tag_id(case["expression_id"], case["tag_id"]) == case["expected"]
