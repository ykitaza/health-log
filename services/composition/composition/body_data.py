"""食事の BodyDataProvider の実装（目標の自動計算に使う体のデータ）。MCP と アプリ用の API の組み立ての場所が使う。

- 体重・体脂肪率：筋トレの体組成の日ごとの値（その日の手入力のいちばん新しい値。手入力がなければ Health Connect の取り込み。
  アプリの dailyBodyValues と同じ）
- 身長・目標体重・活動の量：アプリの設定（同期の setting。ID は height_cm・goal_weight_kg・activity_level）。
  読み方はアプリ（apps/mobile/db/repositories/settings.ts）と同じで、数でない値や知らない活動の量は、ないものとする
性別と生まれた年はアプリの端末の中だけにあり、ここでは読まない。

今週の目標（レポートの材料。MCP の period_overview が返す）も、同じアプリの設定から読む（weekly_goals）。
"""

import math
from datetime import date

import anyio

from meals.domain.auto_goal import Activity, BodyDay
from meals.domain.ports import GoalSettings
from meals.domain.values import EaterId
from sync.engine import SyncEngine
from training.application.queries import TrainingQueries

SETTING_KEYS = {"height_cm": "height_cm", "goal_weight_kg": "goal_weight_kg", "activity": "activity_level"}
# 今週の目標（アプリの設定の weeklyGoalTrainingDays・weeklyGoalMealDays・weeklyGoalSleepDays）。値は週の日数（0〜7 の整数。
# 0 は「切」）。同期の ID は、ほかの設定と同じ snake_case を先に読み、なければアプリの設定の名前（camelCase）を読む
WEEKLY_GOAL_KEYS = {
    "training_days": ("weekly_goal_training_days", "weeklyGoalTrainingDays"),  # 筋トレの回数／週
    "meal_days": ("weekly_goal_meal_days", "weeklyGoalMealDays"),  # 食事を記録する日数／週
    "sleep_days": ("weekly_goal_sleep_days", "weeklyGoalSleepDays"),  # 7時間以上寝る日数／週
}


def _num(v: str | None) -> float | None:
    if v is None or v.strip() == "":
        return None
    try:
        n = float(v)
    except ValueError:
        return None
    return n if math.isfinite(n) else None


def _days_per_week(v: str | None) -> int | None:
    """0〜7 の整数でなければ、ないものとする。"""
    n = _num(v)
    return int(n) if n is not None and n.is_integer() and 0 <= n <= 7 else None


class SyncedBodyData:
    def __init__(self, engine: SyncEngine, queries: TrainingQueries):
        self.engine, self.queries = engine, queries

    async def body_days(self, eater_id: EaterId) -> list[BodyDay]:
        days = await self.queries.daily_body(eater_id.value)
        return [BodyDay(date.fromisoformat(d.date), d.weight_kg, d.body_fat_pct) for d in days]

    def _settings(self, user: str) -> dict[str, str | None]:
        states = [d.own for d in self.engine.docs_of_type(user, "setting") if d.own is not None]
        return {s.entity_id: s.values.get("value") for s in states if not s.deleted}

    async def goal_settings(self, eater_id: EaterId) -> GoalSettings:
        values = await anyio.to_thread.run_sync(self._settings, eater_id.value)
        activity = values.get(SETTING_KEYS["activity"])
        return GoalSettings(
            height_cm=_num(values.get(SETTING_KEYS["height_cm"])),
            goal_weight_kg=_num(values.get(SETTING_KEYS["goal_weight_kg"])),
            activity=Activity(activity) if activity in {a.value for a in Activity} else None,
        )

    async def weekly_goals(self, eater_id: EaterId) -> dict[str, int | None]:
        """今週の目標（training_days・meal_days・sleep_days）。入っていない・読めない項目は None。"""
        values = await anyio.to_thread.run_sync(self._settings, eater_id.value)

        def read(keys: tuple[str, str]) -> int | None:
            snake, camel = keys
            return _days_per_week(values[snake] if snake in values else values.get(camel))

        return {name: read(keys) for name, keys in WEEKLY_GOAL_KEYS.items()}
