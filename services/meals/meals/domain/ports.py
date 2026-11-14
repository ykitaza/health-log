"""ポート：食事記録のドメインが外に求める働きの型。実装は infrastructure/ に置く。

どれも食べた人（EaterId）ごとに分けて読み書きする。ほかの人の記録には届かない。
どれも外のシステム（DB など）を呼ぶ（待ち時間がある）ので、async にしておく。
"""

from dataclasses import dataclass
from datetime import date
from typing import Protocol

from meals.domain.auto_goal import Activity, BodyDay
from meals.domain.body_weight import WeightRecord
from meals.domain.meal import Meal
from meals.domain.meal_template import MealTemplate
from meals.domain.nutrition_goal import NutritionGoal
from meals.domain.values import DayType, EaterId, MealSlot


class EaterResolver(Protocol):
    async def resolve(self, subject: str) -> EaterId:
        """認可コンテキストの本人（アクセストークンの sub）を、食べた人に変える（腐敗防止層）。"""
        ...


class MealRepository(Protocol):
    async def save(self, meal: Meal) -> None: ...

    async def get(self, eater_id: EaterId, meal_id: str) -> Meal | None: ...

    async def delete(self, eater_id: EaterId, meal_id: str) -> None: ...

    async def find(self, eater_id: EaterId, start: date, end: date, slot: MealSlot | None = None) -> list[Meal]:
        """start から end まで（両端を含む）の食事を、食べた日・区分の順で返す。"""
        ...


class MealTemplateRepository(Protocol):
    async def save(self, template: MealTemplate) -> None:
        """同じ名前があれば上書きする。"""
        ...

    async def get(self, eater_id: EaterId, name: str) -> MealTemplate | None: ...

    async def list(self, eater_id: EaterId) -> list[MealTemplate]: ...


class GoalRepository(Protocol):
    async def save(self, goal: NutritionGoal) -> None: ...

    async def get(self, eater_id: EaterId) -> NutritionGoal | None: ...


class WeightRepository(Protocol):
    """体重の記録（目標体重までの進み具合に使う）。

    体重は筋トレのコンテキストの体組成（body_record）に一本化していて、食事は保存しない。
    実装は組み立ての場所（services/composition/composition/adapters.py の BodyRecordWeights）が、筋トレのユースケースにつなぐ。
    """

    async def save(self, record: WeightRecord) -> None:
        """同じ日の記録があれば上書きする。"""
        ...

    async def find(self, eater_id: EaterId, start: date, end: date) -> list[WeightRecord]:
        """start から end まで（両端を含む）の記録を、日付の順で返す（1日に1つ）。"""
        ...


class DayTypeRepository(Protocol):
    async def set(self, eater_id: EaterId, day: date, day_type: DayType) -> None: ...

    async def get(self, eater_id: EaterId, day: date) -> DayType | None:
        """決めていない日は None。"""
        ...


class TrainingDayProvider(Protocol):
    """筋トレの記録がある日を教える（筋トレのコンテキストが持つ記録。つなぐのは組み立ての場所）。

    日の種類を本人が決めていない日は、ここで筋トレの記録がある日を「筋トレの日」にする。
    """

    async def training_days(self, eater_id: EaterId, start: date, end: date) -> set[date]:
        """start から end まで（両端を含む）のうち、筋トレの記録がある日。"""
        ...


@dataclass(frozen=True)
class GoalSettings:
    """目標の自動計算に使う、アプリの設定（同期される）。入っていない項目は None。"""

    height_cm: float | None
    goal_weight_kg: float | None
    activity: Activity | None


class BodyDataProvider(Protocol):
    """目標の自動計算に使う体のデータ（筋トレのコンテキストの体組成と、アプリの設定。つなぐのは組み立ての場所）。

    性別と生まれた年は、アプリでは端末の中だけにあり、サーバーにはない（ここでは読まない）。
    """

    async def body_days(self, eater_id: EaterId) -> list[BodyDay]:
        """日ごとの体重と体脂肪率（その日の手入力のいちばん新しい値。手入力がなければ Health Connect の取り込み）。"""
        ...

    async def goal_settings(self, eater_id: EaterId) -> GoalSettings: ...
