"""筋トレの対象を同期に登録し、アプリから届いた変更を、ドメインの形で読む。"""

import asyncio
import uuid

import pytest

from sync.engine import SyncEngine
from sync.model import Change
from sync.registry import Registry, Rejection
from sync.store import InMemorySyncStore
from training.domain.errors import TrainingError
from training.domain.injury import Injury
from training.domain.model import TraineeId, WorkoutEntry, WorkoutSet
from training.infrastructure.sync_repository import SyncTrainingRepository
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
    ("body_record", {"date": "2026-11-08", "measured_at": "2026-11-08T07:00:00Z", "source": "manual", "body_fat_pct": 101}),
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
                         "weight_kg": 30, "body_fat_pct": 100}),
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


def test_体組成の筋肉率とウエストは_前の版のアプリが送っても断らずに捨てる():
    raw = {"change_id": str(uuid.uuid4()), "entity_type": "body_record", "entity_id": "x", "op": "create",
           "fields": {"date": "2026-11-08", "measured_at": "2026-11-08T07:00:00Z", "source": "manual", "weight_kg": 70,
                      "muscle_pct": 40.1, "waist_cm": 80, "memo": ""},
           "changed_at": "2026-11-08T09:00:00Z"}
    parsed = REGISTRY.parse_change(raw, set(REGISTRY.specs), "pixel")
    assert isinstance(parsed, Change)
    assert parsed.fields == {"date": "2026-11-08", "measured_at": "2026-11-08T07:00:00Z", "source": "manual",
                             "weight_kg": 70, "memo": ""}
    # 範囲の外の値でも断らない（もう確かめない）
    raw = {**raw, "change_id": str(uuid.uuid4()), "op": "update", "fields": {"weight_kg": 71, "waist_cm": 1000}}
    assert REGISTRY.parse_change(raw, set(REGISTRY.specs), "pixel").fields == {"weight_kg": 71}


def test_筋トレの種類は_training_の_scope():
    assert REGISTRY.types_in({"training"}) == {
        "body_part", "exercise", "workout_entry", "workout_set", "body_record", "setting", "sleep_session", "heart_rate_day",
        "step_day", "injury", "injury_review", "phase"}
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
    # 脊柱起立筋：背中上部と腰は、どちらも左右を付けられる（腰の筋肉の左右なしの記録も今までどおり受け付ける）
    for fields in ({"site": "upper_back", "side": "right"}, {"site": "lower_back", "side": "left"},
                   {"site": "lower_back", "side": None}):
        assert isinstance(parse({**INJURY, **fields}), Change), fields
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



PHASE = {"kind": "normal", "direction": "bulk", "name": "", "start_date": "2026-11-02", "end_date": "2027-02-21",
         "target_weight_kg": 80, "status": "active", "paused_phase_id": None, "ended_on": None,
         "meal_targets": {"training_day": {"kcal": 3000, "protein_g": 150}, "rest_day": {"kcal": 2600, "protein_g": 150}},
         "snapshot": {"weight_kg": 72.4, "body_fat_pct": 15.2, "big3": {"bench": 100.0, "squat": None, "deadlift": 140},
                      "growth_score": 62},
         "target_history": [{"date": "2026-11-02", "target_weight_kg": 80, "end_date": "2027-02-21", "weight_kg": 72.4}]}
REHAB = {"kind": "rehab", "direction": None, "name": "肘", "start_date": "2026-11-20", "end_date": None,
         "target_weight_kg": None, "status": "active", "paused_phase_id": "p1", "ended_on": None,
         "meal_targets": None, "snapshot": None, "target_history": []}


def test_フェーズ_アプリから受け付ける範囲():
    def parse(fields, op="create"):
        return REGISTRY.parse_change(raw_change("phase", fields, op), set(REGISTRY.specs), "pixel")

    assert isinstance(parse(PHASE), Change)
    assert isinstance(parse(REHAB), Change)
    assert isinstance(parse({"kind": "rehab", "start_date": "2026-11-20", "status": "active"}), Change)  # 要るのは3つだけ
    assert isinstance(parse({"status": "ended", "ended_on": "2026-12-01"}, "update"), Change)
    assert isinstance(parse({"target_weight_kg": 78.5, "end_date": "2027-03-01"}, "update"), Change)
    # アプリの「開始日・最初の計画を直す」：開始日・終了日・目標・履歴（開始日からの1本）・開始時の記録を1つの update で送る
    corrected = {"start_date": "2026-10-26", "end_date": "2027-01-17", "target_weight_kg": 79,
                 "target_history": [{"date": "2026-10-26", "target_weight_kg": 79, "end_date": "2027-01-17", "weight_kg": 71.8}],
                 "snapshot": {"weight_kg": 71.8, "body_fat_pct": None, "big3": None, "growth_score": 40}}
    assert isinstance(parse(corrected, "update"), Change)
    # 「今日から計画を変える」で期間を縮める（組で送る開始日と開始時の記録は変わらない値のまま入る）
    assert isinstance(parse({"start_date": "2026-11-02", "end_date": "2026-12-27", "target_weight_kg": 80, "snapshot": PHASE["snapshot"],
                             "target_history": [*PHASE["target_history"], {"date": "2026-11-08", "target_weight_kg": 80,
                                                                           "end_date": "2026-12-27", "weight_kg": None}]}, "update"), Change)
    assert isinstance(parse({**corrected, "end_date": "2026-10-25"}, "update"), Rejection)  # 終了日が開始日より前
    assert isinstance(parse({**PHASE, "name": "あ" * 40, "meal_targets": None, "snapshot": None}), Change)
    for bad in ({"kind": "bulk"}, {"direction": "up"}, {"status": "paused"}, {"name": "あ" * 41},
                {"direction": None}, {"end_date": None}, {"target_weight_kg": None}, {"target_weight_kg": 20},
                {"end_date": "2026-11-01"}, {"ended_on": "2026-12-01"}, {"status": "ended"},
                {"paused_phase_id": "p0"}, {"start_date": "11/02"},
                {"meal_targets": {"training_day": {"kcal": 3000}}},
                {"meal_targets": {"training_day": {"kcal": -1}, "rest_day": {}}},
                {"snapshot": {"weight_kg": 72, "waist_cm": 80}}, {"snapshot": {"growth_score": 101}},
                {"target_history": [{"date": "2026-11-02", "target_weight_kg": 80}]},
                {"target_history": [PHASE["target_history"][0]] * 101}):
        assert isinstance(parse({**PHASE, **bad}), Rejection), bad
    for bad in ({"direction": "cut"}, {"target_weight_kg": 70}, {"end_date": "2026-12-01"}, {"paused_phase_id": "x"}):
        assert isinstance(parse({**REHAB, **bad}), Rejection), bad
    rejection = parse({"kind": "normal", "start_date": "2026-11-02"})
    assert isinstance(rejection, Rejection) and rejection.code == "missing_fields"
    rejection = REGISTRY.parse_change(raw_change("phase", PHASE), REGISTRY.types_in({"meals"}), "pixel")
    assert isinstance(rejection, Rejection) and rejection.code == "insufficient_scope"


def test_フェーズ_読む_療養は向きと目標を捨て_今のフェーズは療養(engine):
    engine.append(USER, [
        change("phase", "p1", fields=PHASE),
        change("phase", "r1", fields=REHAB),
        # 項目ごとに後勝ちなので、療養に向きが残ることがある（読むときに捨てる）
        change("phase", "r1", "update", {"kind": "rehab"}, at="2026-11-08T09:10:00.000Z"),
        change("phase", "old", fields={**PHASE, "start_date": "2026-08-01", "end_date": "2026-10-31", "status": "ended",
                                       "ended_on": "2026-11-01", "target_history": []}),
        change("phase", "gone", fields={**PHASE, "start_date": "2026-11-05"}),
        change("phase", "gone", "delete", at="2026-11-08T09:20:00.000Z"),
    ])
    queries = create_queries(engine)
    phases = asyncio.run(queries.phases(USER))
    assert [p.id for p in phases] == ["r1", "p1", "old"]
    assert phases[0].direction is None and phases[0].paused_phase_id == "p1"
    assert phases[1].snapshot["big3"]["bench"] == 100.0
    listed, current, paused = asyncio.run(queries.phase_progresses(USER, "2026-11-22"))
    assert (current.phase.id, current.rehab_days, paused.phase.id, paused.paused) == ("r1", 3, "p1", True)
    assert paused.pace.reason == "paused" and paused.effective_end == "2027-02-24"
    # 期間で絞る：前のフェーズは 10/31 で終わった（ended_on は含まない）
    listed, _, _ = asyncio.run(queries.phase_progresses(USER, "2026-11-22", start="2026-11-01"))
    assert [pp.phase.id for pp in listed] == ["r1", "p1"]
    listed, _, _ = asyncio.run(queries.phase_progresses(USER, "2026-11-22", start="2026-10-31"))
    assert [pp.phase.id for pp in listed] == ["r1", "p1", "old"]


# --- MCP から書く変更も、アプリから届く変更と同じ決まり（sync_entities.py）で確かめる ---


def _bench_entry(*sets):
    return WorkoutEntry("e9", "2026-11-08", "bench", 0, tuple(sets))


def test_MCP_の書き込み_アプリの範囲の外のセットは断り_何も書かない(engine):
    seed(engine)
    head = engine.head(USER)
    repo = SyncTrainingRepository(engine)
    ok, too_far = WorkoutSet("s8", 0, 80.0, 5), WorkoutSet("s9", 1001, 80.0, 5)  # set_index は 1000 まで
    with pytest.raises(TrainingError, match="記録できない値です.*set_index"):
        asyncio.run(repo.save_entries(TraineeId(USER), [_bench_entry(ok, too_far)], [], []))
    assert engine.head(USER) == head  # 合わない変更があれば、合う変更も書かない
    with pytest.raises(TrainingError, match="weight_kg"):
        asyncio.run(repo.save_entries(TraineeId(USER), [_bench_entry(WorkoutSet("s8", 0, 501.0, 5))], [], []))
    assert engine.head(USER) == head


def test_MCP_の書き込み_項目の組み合わせの決まりも確かめる(engine):
    head = engine.head(USER)
    repo = SyncTrainingRepository(engine)
    sided_abs = Injury("i9", "2026-11-08", "abs", "left", None, "", "", "", "", "fixing", None)  # 腹筋に左右はない
    with pytest.raises(TrainingError, match="記録できない値です.*side"):
        asyncio.run(repo.save_injury(TraineeId(USER), sided_abs))
    assert engine.head(USER) == head


def test_MCP_の書き込み_合う変更は今までどおり書く_消すのは確かめない(engine):
    seed(engine)
    repo = SyncTrainingRepository(engine)
    asyncio.run(repo.save_entries(TraineeId(USER), [_bench_entry(WorkoutSet("s8", 1000, 500.0, 10000))], [], []))
    asyncio.run(repo.save_entries(TraineeId(USER), [], ["s8"], []))
    states = {d.own.entity_id: d.own for d in engine.docs_of_type(USER, "workout_set")}
    assert states["s8"].deleted and states["s8"].values["set_index"] == 1000
