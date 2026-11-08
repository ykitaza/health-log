"""移行のスクリプト（scripts/migrate_to_sync.py）。moto の DynamoDB で、今の形の項目から移す。"""

import importlib.util
from datetime import date, time
from pathlib import Path

import pytest

from domain.body_weight import WeightRecord
from domain.meal_template import MealTemplate
from domain.nutrition_goal import DailyTarget, NutritionGoal, Policy
from domain.values import DayType, EatenOn, EaterId, MealSlot
from infrastructure import dynamodb_repositories as dynamo
from infrastructure import sync_repositories as synced
from sync.engine import SyncEngine
from sync.store import DynamoDBSyncStore
from tests.domain.factories import EATER, lunch
from tests.sync.conftest import TABLE

_spec = importlib.util.spec_from_file_location(
    "migrate_to_sync", Path(__file__).parents[2] / "scripts" / "migrate_to_sync.py")
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)

GOAL = NutritionGoal(EATER, Policy.BULK, 70, 2.0, DailyTarget(2800, 70, 380), DailyTarget(2400, 70, 280))
OTHER = EaterId("someone-else")


async def _old_data():
    """今の MCP（移行の前）が書く形の項目。"""
    await dynamo.DynamoDBMealRepository(TABLE).save(lunch("m1", EatenOn(date(2026, 10, 12), MealSlot.LUNCH, time(12, 30))))
    await dynamo.DynamoDBMealRepository(TABLE).save(lunch("m2", eater=OTHER))
    await dynamo.DynamoDBMealTemplateRepository(TABLE).save(MealTemplate.from_meal(lunch(), "いつもの昼"))
    await dynamo.DynamoDBGoalRepository(TABLE).save(GOAL)
    await dynamo.DynamoDBDayTypeRepository(TABLE).set(EATER, date(2026, 10, 12), DayType.TRAINING)
    await dynamo.DynamoDBWeightRepository(TABLE).save(WeightRecord(EATER, date(2026, 10, 12), 67.0))  # 移さない


@pytest.mark.anyio
async def test_読み取りだけなら何も書かない(dynamodb_table):
    await _old_data()
    counts = migration.migrate(TABLE, apply=False)
    assert (counts["meal"], counts["meal_template"], counts["nutrition_goal"], counts["day_type"]) == (2, 1, 1, 1)
    assert counts["users"] == 2 and counts["accepted"] == 0
    assert SyncEngine(DynamoDBSyncStore(TABLE)).head(EATER.value) == 0


@pytest.mark.anyio
async def test_移すと同期の実装で同じものが読め_もう一度動かしても増えない(dynamodb_table):
    await _old_data()
    counts = migration.migrate(TABLE, apply=True, changed_at="2026-11-08T00:00:00.000Z")
    assert counts["accepted"] == counts["changes"] == 2 * 3 + 1 + 1 + 1  # 食事2件は、食事1つと品目2つずつ
    engine = SyncEngine(DynamoDBSyncStore(TABLE))
    meals = synced.SyncMealRepository(engine)
    assert await meals.get(EATER, "m1") == lunch("m1", EatenOn(date(2026, 10, 12), MealSlot.LUNCH, time(12, 30)))
    assert await meals.get(EATER, "m2") is None  # ほかの人の食事は、その人の pk に移る
    assert await meals.get(OTHER, "m2") == lunch("m2", eater=OTHER)
    assert await synced.SyncMealTemplateRepository(engine).get(EATER, "いつもの昼") == MealTemplate.from_meal(
        lunch(), "いつもの昼")
    assert await synced.SyncGoalRepository(engine).get(EATER) == GOAL
    assert await synced.SyncDayTypeRepository(engine).get(EATER, date(2026, 10, 12)) == DayType.TRAINING

    again = migration.migrate(TABLE, apply=True)
    assert again["accepted"] == 0 and again["duplicate"] == counts["changes"]
    assert await dynamo.DynamoDBMealRepository(TABLE).get(EATER, "m1") is not None  # 古い項目は消さない
