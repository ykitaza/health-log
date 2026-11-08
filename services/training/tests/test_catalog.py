"""部位と種目のカタログ。初期のものはアプリと同じ ID と名前か、名前での探し方。"""

import re
from pathlib import Path

import pytest

from training.domain.catalog import SEED_BODY_PARTS, SEED_EXERCISES, Catalog, normalize
from training.domain.errors import NotFound, TrainingError
from training.domain.model import Exercise, RecordType

SEED_TS = Path(__file__).parents[3] / "apps" / "mobile" / "db" / "seed.ts"
CATALOG = Catalog(SEED_BODY_PARTS, SEED_EXERCISES)


def test_初期の部位と種目はアプリと同じ_ID_名前_並び_記録の仕方():
    src = SEED_TS.read_text()
    parts = re.findall(r"\{ id: '([0-9a-f-]+)', name: '([^']+)' \}", src)
    assert [(p.id, p.name, p.sort_order) for p in SEED_BODY_PARTS] == [(i, n, k) for k, (i, n) in enumerate(parts)]
    consts = dict(zip(["CHEST", "BACK", "SHOULDER", "LEGS", "BICEPS", "TRICEPS", "ABS"], (i for i, _ in parts)))
    exercises = re.findall(r"\{ id: '([0-9a-f-]+)', bodyPartId: (\w+), name: '([^']+)', recordType: (\w) \}", src)
    kinds = {"W": "weight_reps", "R": "reps_only"}
    assert [(e.id, e.body_part_id, e.name, e.record_type.value, e.sort_order) for e in SEED_EXERCISES] == [
        (i, consts[p], n, kinds[k], s) for s, (i, p, n, k) in enumerate(exercises)]


def test_名前は全角半角_大文字小文字_空白を同じに扱う():
    assert normalize(" Ｂｅｎｃｈ　Press ") == normalize("bench press") == "benchpress"
    assert CATALOG.find_exercise("ベンチプレス").name == "ベンチプレス"
    assert CATALOG.find_exercise("d41c7096-c246-4dfa-945a-e1cb329977a6").name == "ベンチプレス"


def test_略した名前では選ばず_候補を返す():
    with pytest.raises(NotFound, match="ベンチ.*近い名前：ベンチプレス"):
        CATALOG.find_exercise("ベンチ")
    with pytest.raises(NotFound, match="add_exercise"):
        CATALOG.find_exercise("ケトルベルスイング")


def test_同じ名前が2つあれば_ID_で選ばせる():
    twin = Exercise("x1", SEED_BODY_PARTS[1].id, "ベンチプレス", RecordType.WEIGHT_REPS, 99, False)
    with pytest.raises(TrainingError, match="2つあります.*x1"):
        Catalog(SEED_BODY_PARTS, SEED_EXERCISES + (twin,)).find_exercise("ベンチプレス")


def test_部位は名前で探す():
    assert CATALOG.find_body_part("胸").id == SEED_BODY_PARTS[0].id
    with pytest.raises(NotFound, match="部位：胸、背中"):
        CATALOG.find_body_part("首")
