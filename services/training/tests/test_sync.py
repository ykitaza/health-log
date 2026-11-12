"""筋トレの対象を同期に登録し、アプリから届いた変更を、ドメインの形で読む。"""

import asyncio
import uuid

import pytest

from sync.engine import SyncEngine
from sync.model import Change
from sync.registry import Registry, Rejection
from sync.store import InMemorySyncStore
from training.domain.model import TraineeId
from training.main import create_queries, register_sync_entities

REGISTRY = Registry()
register_sync_entities(REGISTRY)
USER = "user-1"


def change(entity_type, entity_id, op="create", fields=None, at="2026-11-08T09:00:00.000Z", origin="app"):
    return Change(str(uuid.uuid4()), entity_type, entity_id, None, op, fields, at, origin)


@pytest.fixture
def engine():
    return SyncEngine(InMemorySyncStore(REGISTRY.index_key), REGISTRY, clock=lambda: "2026-11-08T10:00:00.000Z")


def seed(engine):
    engine.append(USER, [
        change("body_part", "chest", fields={"name": "胸", "sort_order": 0, "hidden": False}),
        change("exercise", "bench", fields={"body_part_id": "chest", "name": "ベンチプレス", "record_type": "weight_reps",
                                            "sort_order": 0, "hidden": False}),
        change("workout_entry", "e1", fields={"date": "2026-11-01", "exercise_id": "bench", "sort_order": 0}),
        change("workout_set", "s1", fields={"entry_id": "e1", "set_index": 0, "weight_kg": 80.0, "reps": 8}),
        change("workout_set", "s2", fields={"entry_id": "e1", "set_index": 1, "weight_kg": 85.0, "reps": 5}),
        change("workout_entry", "e2", fields={"date": "2026-11-08", "exercise_id": "bench", "sort_order": 0}),
        change("workout_set", "s3", fields={"entry_id": "e2", "set_index": 0, "weight_kg": 100.0, "reps": 1}),
    ])


def test_その日のトレーニングと週のふり返り(engine):
    seed(engine)
    queries = create_queries(engine)
    workout = asyncio.run(queries.workout(USER, "2026-11-01"))
    assert [(s.weight_kg, s.reps) for s in workout.entries[0].sets] == [(80.0, 8), (85.0, 5)]
    review = asyncio.run(queries.weekly_review(USER, "2026-11-08", weeks=2))
    assert review.weekly_volumes == [100.0, 80 * 8 + 85 * 5]
    assert review.training_days == ["2026-11-01", "2026-11-08"]
    history = asyncio.run(queries.exercise_history(USER, "bench"))
    # 80kg × 8 の推定1RM（101.3）は、100kg × 1（100）より大きい
    assert (history.personal_best.weight_kg, history.personal_best.reps) == (80.0, 8)
    assert [p.date for p in history.series] == ["2026-11-01", "2026-11-08"]


def test_消したセットと消した日の種目は集計に入れない_種目を消しても過去の記録は残る(engine):
    seed(engine)
    engine.append(USER, [change("workout_set", "s2", "delete"), change("workout_entry", "e2", "delete"),
                         change("exercise", "bench", "delete")])
    queries = create_queries(engine)
    review = asyncio.run(queries.weekly_review(USER, "2026-11-08", weeks=2))
    assert review.weekly_volumes == [0, 80 * 8]  # 今週（11-02〜11-08。11-08 の分）は日ごと消した。先週（11-01 の分）は s1 だけ残る
    assert asyncio.run(queries.repository.exercises(TraineeId(USER))) == []  # 種目の一覧からは消える


def test_ほかの人の記録は見えない(engine):
    seed(engine)
    review = asyncio.run(create_queries(engine).weekly_review("user-2", "2026-11-08"))
    assert review.training_days == [] and review.totals.total == 0


def test_体組成は手入力が取り込みに勝つ(engine):
    record = {"date": "2026-11-08", "measured_at": "2026-11-08T07:00:00+09:00", "weight_kg": 70.0, "source": "health_connect"}
    engine.append(USER, [change("body_record", "b1", fields=record, origin="import")])
    engine.append(USER, [change("body_record", "b1", "update", {"weight_kg": 69.5})])
    engine.append(USER, [change("body_record", "b1", fields={**record, "weight_kg": 71.0}, origin="import",
                                at="2026-11-08T09:30:00.000Z")])
    days = asyncio.run(create_queries(engine).daily_body(USER))
    assert days[0].weight_kg == 69.5


@pytest.mark.parametrize("entity_type,fields", [
    ("workout_set", {"entry_id": "e1", "set_index": 0, "weight_kg": 500.5, "reps": 1}),  # 重量は500kgまで（アプリと同じ）
    ("workout_set", {"entry_id": "e1", "set_index": 0, "weight_kg": 0, "reps": 1}),  # 0より大きい
    ("workout_set", {"entry_id": "e1", "set_index": 0, "reps": 1.5}),  # 回数は整数
    ("body_record", {"date": "2026-11-08", "measured_at": "2026-11-08T07:00:00Z", "source": "manual", "waist_cm": 20}),
    ("exercise", {"body_part_id": "chest", "name": "", "record_type": "weight_reps", "sort_order": 0, "hidden": False}),
    ("exercise", {"body_part_id": "chest", "name": "x", "record_type": "time", "sort_order": 0, "hidden": False}),
    ("exercise", {"body_part_id": "chest", "name": "懸垂", "record_type": "reps_only", "sort_order": 0, "hidden": False,
                  "bodyweight_ratio": 1.01}),  # 体重に対する割合は 0〜1
    ("exercise", {"body_part_id": "chest", "name": "懸垂", "record_type": "reps_only", "sort_order": 0, "hidden": False,
                  "bodyweight_ratio": -0.1}),
    ("exercise", {"big3": "overhead_press"}),  # BIG3 の役は3つだけ
    ("exercise", {"form_video_url": "http://youtu.be/x"}),  # フォームの動画は https:// だけ
    ("exercise", {"form_video_url": "https://"}),
    ("exercise", {"form_video_url": "https://youtu.be/a b"}),  # 空白を含まない
    ("exercise", {"form_video_url": "javascript:alert(1)"}),
    ("exercise", {"form_video_url": "https://youtu.be/" + "a" * 1984}),  # 2000文字まで（17 + 1984 = 2001）
])
def test_アプリの範囲の外は断る(entity_type, fields):
    raw = {"change_id": str(uuid.uuid4()), "entity_type": entity_type, "entity_id": "x", "op": "create",
           "fields": fields, "changed_at": "2026-11-08T09:00:00Z"}
    assert REGISTRY.parse_change(raw, set(REGISTRY.specs), "pixel").code == "invalid_fields"


def test_アプリの範囲の端は受け付ける_名前は絵文字を含めて40文字():
    name = "👨‍👩‍👧‍👦" * 40  # アプリでは40文字（書記素）。コードポイントでは280
    raws = [
        ("workout_set", {"entry_id": "e1", "set_index": 0, "weight_kg": 500, "reps": 1}),
        ("body_record", {"date": "2026-11-08", "measured_at": "2026-11-08T07:00:00Z", "source": "manual",
                         "weight_kg": 30, "waist_cm": 200}),
        ("body_part", {"name": "胸" * 40, "sort_order": 0, "hidden": False}),
        ("exercise", {"body_part_id": "chest", "name": "懸垂", "record_type": "reps_only", "sort_order": 0,
                      "hidden": False, "bodyweight_ratio": 1}),
        ("exercise", {"body_part_id": "back", "name": "デッドリフト", "record_type": "weight_reps", "sort_order": 0,
                      "hidden": False, "big3": "deadlift", "form_video_url": "https://youtu.be/" + "a" * 1983}),
        ("exercise", {"body_part_id": "back", "name": "デッドリフト", "record_type": "weight_reps", "sort_order": 0,
                      "hidden": False, "big3": None, "form_video_url": None}),  # 割り当てなし・リンクなし
    ]
    for entity_type, fields in raws:
        raw = {"change_id": str(uuid.uuid4()), "entity_type": entity_type, "entity_id": "x", "op": "create",
               "fields": fields, "changed_at": "2026-11-08T09:00:00Z"}
        assert isinstance(REGISTRY.parse_change(raw, set(REGISTRY.specs), "pixel"), Change), entity_type
    assert len(name) == 280


def test_筋トレの種類は_training_の_scope():
    assert REGISTRY.types_in({"training"}) == {
        "body_part", "exercise", "workout_entry", "workout_set", "body_record", "setting", "sleep_session", "heart_rate_day",
        "step_day", "injury", "injury_review"}
    assert REGISTRY.types_in({"meals"}) == set()


SLEEP = {"date": "2026-11-07", "start_at": "2026-11-06T14:40:00.000Z", "end_at": "2026-11-06T21:55:00.000Z",
         "asleep_min": 420, "awake_min": 15, "source": "health_connect", "external_id": "s1", "origin_package": "com.example.watch"}


def sleep_change(fields, op="create", origin="import"):
    return {"change_id": str(uuid.uuid4()), "entity_type": "sleep_session", "entity_id": "x", "op": op,
            "fields": fields, "changed_at": "2026-11-08T09:00:00Z", "origin": origin}


def test_睡眠_取り込みを受け付ける_24時間までの分_日付と時刻の形():
    assert isinstance(REGISTRY.parse_change(sleep_change(SLEEP), set(REGISTRY.specs), "pixel"), Change)
    assert isinstance(REGISTRY.parse_change(sleep_change({**SLEEP, "asleep_min": 1440, "awake_min": 0}), set(REGISTRY.specs), "pixel"),
                      Change)
    for bad in ({"asleep_min": 1441}, {"awake_min": -1}, {"asleep_min": 7.5}, {"date": "2026/11/07"},
                {"start_at": "2026-11-06T14:40:00"}, {"source": "manual"}):
        assert isinstance(REGISTRY.parse_change(sleep_change({**SLEEP, **bad}), set(REGISTRY.specs), "pixel"), Rejection), bad
    missing = {k: v for k, v in SLEEP.items() if k != "asleep_min"}
    rejection = REGISTRY.parse_change(sleep_change(missing), set(REGISTRY.specs), "pixel")
    assert isinstance(rejection, Rejection) and rejection.code == "missing_fields"
    # meals の scope だけでは書けない
    rejection = REGISTRY.parse_change(sleep_change(SLEEP), REGISTRY.types_in({"meals"}), "pixel")
    assert isinstance(rejection, Rejection) and rejection.code == "insufficient_scope"


def test_心拍の日のまとめ_受け付ける範囲():
    def raw(fields, op="create"):
        return {"change_id": str(uuid.uuid4()), "entity_type": "heart_rate_day", "entity_id": "x", "op": op,
                "fields": fields, "changed_at": "2026-11-08T09:00:00Z", "origin": "import"}

    day = {"date": "2026-11-07", "resting_bpm": 55, "avg_bpm": 72.5, "min_bpm": 48, "max_bpm": 160, "samples": 1200}
    assert isinstance(REGISTRY.parse_change(raw(day), set(REGISTRY.specs), "pixel"), Change)
    # 安静時心拍しかない日
    only_resting = {"date": "2026-11-06", "resting_bpm": 57, "avg_bpm": None, "min_bpm": None, "max_bpm": None, "samples": 0}
    assert isinstance(REGISTRY.parse_change(raw(only_resting), set(REGISTRY.specs), "pixel"), Change)
    for bad in ({"avg_bpm": 0}, {"max_bpm": 301}, {"samples": -1}, {"samples": 1.5}, {"samples": None}, {"date": "11/07"}):
        assert isinstance(REGISTRY.parse_change(raw({**day, **bad}), set(REGISTRY.specs), "pixel"), Rejection), bad
    rejection = REGISTRY.parse_change(raw({"date": "2026-11-07"}), set(REGISTRY.specs), "pixel")
    assert isinstance(rejection, Rejection) and rejection.code == "missing_fields"
    # サンプルそのものは受け取らない
    rejection = REGISTRY.parse_change(raw({**day, "samples_list": [60, 61]}), set(REGISTRY.specs), "pixel")
    assert isinstance(rejection, Rejection) and rejection.code == "invalid_fields"


def test_歩数の日の合計_受け付ける範囲():
    def raw(fields, op="create"):
        return {"change_id": str(uuid.uuid4()), "entity_type": "step_day", "entity_id": "x", "op": op,
                "fields": fields, "changed_at": "2026-11-08T09:00:00Z", "origin": "import"}

    day = {"date": "2026-11-07", "steps": 8240}
    assert isinstance(REGISTRY.parse_change(raw(day), set(REGISTRY.specs), "pixel"), Change)
    assert isinstance(REGISTRY.parse_change(raw({**day, "steps": 1000000}), set(REGISTRY.specs), "pixel"), Change)
    for bad in ({"steps": 0}, {"steps": 1000001}, {"steps": 1.5}, {"steps": None}, {"date": "11/07"}):
        assert isinstance(REGISTRY.parse_change(raw({**day, **bad}), set(REGISTRY.specs), "pixel"), Rejection), bad
    rejection = REGISTRY.parse_change(raw({"date": "2026-11-07"}), set(REGISTRY.specs), "pixel")
    assert isinstance(rejection, Rejection) and rejection.code == "missing_fields"
    # 1件ごとの記録は受け取らない
    rejection = REGISTRY.parse_change(raw({**day, "records": [{"count": 100}]}), set(REGISTRY.specs), "pixel")
    assert isinstance(rejection, Rejection) and rejection.code == "invalid_fields"
    # meals の scope だけでは書けない
    rejection = REGISTRY.parse_change(raw(day), REGISTRY.types_in({"meals"}), "pixel")
    assert isinstance(rejection, Rejection) and rejection.code == "insufficient_scope"


INJURY = {"occurred_on": "2026-11-05", "site": "elbow", "side": "left", "exercise_id": "bench", "phase": "下ろすとき",
          "symptom": "肘の内側が痛い", "cause": "", "fix": "", "status": "fixing", "fixed_on": None}


def raw_change(entity_type, fields, op="create"):
    return {"change_id": str(uuid.uuid4()), "entity_type": entity_type, "entity_id": "x", "op": op,
            "fields": fields, "changed_at": "2026-11-08T09:00:00Z"}


def test_ケガ_アプリから受け付ける範囲():
    def parse(fields, op="create", entity_type="injury"):
        return REGISTRY.parse_change(raw_change(entity_type, fields, op), set(REGISTRY.specs), "pixel")

    assert isinstance(parse(INJURY), Change)
    assert isinstance(parse({"occurred_on": "2026-11-05", "site": "abs", "status": "fixing"}), Change)  # 要るのは3つだけ
    assert isinstance(parse({**INJURY, "status": "fixed", "fixed_on": "2026-11-05"}), Change)
    assert isinstance(parse({**INJURY, "phase": "あ" * 100, "fix": "あ" * 500}), Change)
    assert isinstance(parse({"site": "abs"}, "update"), Change)  # 左右は別の変更で null にする（項目ごとに後勝ち）
    assert isinstance(parse({"status": "fixing", "fixed_on": None}, "update"), Change)
    for bad in ({"site": "nose"}, {"side": "both"}, {"site": "abs", "side": "left"}, {"status": "done"},
                {"status": "fixed", "fixed_on": None}, {"status": "fixing", "fixed_on": "2026-11-06"},
                {"status": "fixed", "fixed_on": "2026-11-04"}, {"phase": "あ" * 101}, {"cause": "あ" * 501},
                {"symptom": None}, {"pain_level": 3}, {"diagnosis": "腱炎"}):
        assert isinstance(parse({**INJURY, **bad}), Rejection), bad
    rejection = parse({"occurred_on": "2026-11-05", "site": "elbow"})
    assert isinstance(rejection, Rejection) and rejection.code == "missing_fields"
    review = {"injury_id": "i1", "date": "2026-11-08", "result": "not_yet", "note": "", "exercise_id": None}
    assert isinstance(parse(review, entity_type="injury_review"), Change)
    for bad in ({"result": "ok"}, {"note": "あ" * 501}, {"injury_id": None}, {"date": "11/08"}):
        assert isinstance(parse({**review, **bad}, entity_type="injury_review"), Rejection), bad
    # meals の scope だけでは書けない
    rejection = REGISTRY.parse_change(raw_change("injury", INJURY), REGISTRY.types_in({"meals"}), "pixel")
    assert isinstance(rejection, Rejection) and rejection.code == "insufficient_scope"


def test_ケガ_項目が食い違っていても読み_消したケガの振り返りは出さない(engine):
    engine.append(USER, [
        change("injury", "i1", fields=INJURY),
        change("injury_review", "r1", fields={"injury_id": "i1", "date": "2026-11-06", "result": "pain"}),
        change("injury", "i2", fields={**INJURY, "status": "fixed", "fixed_on": "2026-11-07"}),
        change("injury_review", "r2", fields={"injury_id": "i2", "date": "2026-11-07", "result": "fixed"}),
        # 端末 A が左右のない部位に、端末 B が直している途中に戻した（それぞれの項目だけが後勝ちで残る）
        change("injury", "i1", "update", {"site": "abs"}, at="2026-11-08T09:10:00.000Z"),
        change("injury", "i2", "update", {"status": "fixing"}, at="2026-11-08T09:10:00.000Z"),
        change("injury", "i3", fields={**INJURY, "occurred_on": "2026-11-01"}),
        change("injury_review", "r3", fields={"injury_id": "i3", "date": "2026-11-02", "result": "pain"}),
        change("injury", "i3", "delete", at="2026-11-08T09:20:00.000Z"),  # 振り返りの削除はまだ届いていない
    ])
    queries = create_queries(engine)
    records = asyncio.run(queries.injuries(USER))
    assert [(r.injury.id, r.injury.site, r.injury.side, r.injury.status, r.injury.fixed_on) for r in records] == [
        ("i2", "elbow", "left", "fixing", None), ("i1", "abs", None, "fixing", None)]
    assert [[r.id for r in record.reviews] for record in records] == [["r2"], ["r1"]]
    assert sorted(r.id for r in asyncio.run(queries.repository.injury_reviews(TraineeId(USER)))) == ["r1", "r2"]

