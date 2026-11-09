"""リポジトリの実装（同期の仕組みの上）。読むのは今の状態、書くのは変更の記録（origin は mcp）。

保存のときは今の状態と比べ、違う項目だけを update にする（新しいものは create）。
アプリが同時に別の項目を変えていても、項目ごとに当てはめるので、両方が残る。
消えた対象を MCP が保存し直すとき（同じ名前のいつもの、目標、日の種類）は、restore してから書く。
書く前に、アプリから届く変更と同じ決まり（sync_entities.py）で確かめる（量を変えて kcal が上限を超えた、など）。
アプリから届いた値をドメインが断るときは、その対象だけを読まずにログに残す（一覧の残りは返す）。
体重は食事では保存しない（筋トレの体組成に一本化した。services/mcp/main.py の BodyRecordWeights）。
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, time
from functools import partial

import anyio

from meals.domain.errors import MealError
from meals.domain.meal import FoodItem, Meal
from meals.domain.meal_template import MealTemplate
from meals.domain.nutrition_goal import DailyTarget, EatingStyle, NutritionGoal, Policy
from meals.domain.values import Confidence, DayType, EatenOn, EaterId, MealSlot, Nutrition, Quantity, Source, Unit
from meals.infrastructure.sync_entities import day_key, template_id
from sync.engine import SyncEngine
from sync.model import Change, Doc, EntityState
from sync.registry import Rejection

logger = logging.getLogger(__name__)

SLOT_ORDER = list(MealSlot)
GOAL_ID = "current"
_MISSING = object()


def _unreadable(entity_type: str, eater: EaterId, entity_id: str, error: Exception) -> None:
    """ドメインの決まりに合わない状態（アプリから届いた値、前の形のデータ）。黙って消さず、ログに残す。"""
    logger.warning("読めない %s を飛ばしました（user=%s, id=%s）: %s", entity_type, eater.value, entity_id, error)


def _item_core(i: FoodItem) -> dict:
    return {
        "name": i.name, "amount": i.quantity.amount, "unit": i.quantity.unit.value,
        "kcal": i.nutrition.kcal, "protein_g": i.nutrition.protein_g, "fat_g": i.nutrition.fat_g,
        "carbs_g": i.nutrition.carbs_g, "confidence": i.confidence.value,
    }


def _item_from(item_id: str, v: dict) -> FoodItem:
    return FoodItem(item_id, v["name"], Quantity(v["amount"], Unit(v["unit"])),
                    Nutrition(v["kcal"], v["protein_g"], v["fat_g"], v["carbs_g"]), Confidence(v["confidence"]))


def meal_fields(m: Meal) -> dict:
    fields = {
        "date": m.eaten_on.day.isoformat(), "slot": m.eaten_on.slot.value,
        "time": m.eaten_on.at.strftime("%H:%M") if m.eaten_on.at else None,
        "description": m.description, "source": m.source.value,
    }
    # 推定の根拠は、あるときだけ書く（ないときに空を書くと、アプリや前の記録の値を消してしまうため）
    if m.basis:
        fields["basis"] = m.basis
    return fields


def meal_item_fields(i: FoodItem, order: int) -> dict:
    return {**_item_core(i), "sort_order": order}


def meal_from_doc(doc: Doc, eater: EaterId) -> Meal | None:
    """消えた食事、日付などが届いていない食事、生きている品目がない食事は None（一覧にも出さない）。

    ドメインが断る値（空白だけの品目の名前など）があるときも None にし、ログに残す。
    """
    own = doc.own
    if own is None or own.deleted or not {"date", "slot", "description", "source"} <= own.values.keys():
        return None
    children = [c for c in doc.children.values() if not c.deleted and _ITEM_KEYS <= c.values.keys()]
    if not children:
        return None  # 品目がない（アプリで全部消した）
    children.sort(key=lambda c: (c.values["sort_order"], c.entity_id))
    v = own.values
    try:
        eaten_on = EatenOn(date.fromisoformat(v["date"]), MealSlot(v["slot"]),
                           time.fromisoformat(v["time"]) if v.get("time") else None)
        return Meal(doc.entity_id, eater, eaten_on, tuple(_item_from(c.entity_id, c.values) for c in children),
                    v["description"], Source(v["source"]), v.get("basis") or "")
    except (MealError, ValueError) as e:
        _unreadable("meal", eater, doc.entity_id, e)
        return None


_ITEM_KEYS = {"name", "amount", "unit", "kcal", "protein_g", "fat_g", "carbs_g", "confidence", "sort_order"}


def template_fields(t: MealTemplate) -> dict:
    return {"name": t.name, "items": [{"item_id": i.id, **_item_core(i)} for i in t.items]}


def template_from_state(state: EntityState, eater: EaterId) -> MealTemplate | None:
    """ドメインが断る値があるときは None にし、ログに残す（一覧のほかのいつものは返す）。"""
    v = state.values
    if state.deleted or "name" not in v or not v.get("items"):
        return None
    try:
        items = tuple(_item_from(i.get("item_id") or f"item{n}", i) for n, i in enumerate(v["items"], 1))
        return MealTemplate(eater, v["name"], items)
    except (MealError, ValueError) as e:
        _unreadable("meal_template", eater, state.entity_id, e)
        return None


def _target(t: DailyTarget | None) -> dict | None:
    return None if t is None else {"kcal": t.kcal, "fat_g": t.fat_g, "carbs_g": t.carbs_g}


def goal_fields(g: NutritionGoal) -> dict:
    both = g.training_day is not None and g.rest_day is not None
    return {
        "policy": g.policy.value, "body_weight_kg": g.body_weight_kg, "protein_per_kg": g.protein_per_kg,
        "targets": {"training_day": _target(g.training_day), "rest_day": _target(g.rest_day)} if both else None,
        "eating_style": g.eating_style.value if g.eating_style else None,
        "target_weight_kg": g.target_weight_kg,
    }


def goal_from_state(state: EntityState, eater: EaterId) -> NutritionGoal | None:
    """ドメインが断る値があるときは None（目標が未設定のときと同じ。set_goals で保存し直せる）にし、ログに残す。"""
    v = state.values
    if state.deleted or "policy" not in v:
        return None
    targets = v.get("targets")
    try:
        return NutritionGoal(
            eater, Policy(v["policy"]), v.get("body_weight_kg"), v.get("protein_per_kg"),
            DailyTarget(**targets["training_day"]) if targets else None,
            DailyTarget(**targets["rest_day"]) if targets else None,
            EatingStyle(v["eating_style"]) if v.get("eating_style") else None,
            v.get("target_weight_kg"))
    except (MealError, ValueError) as e:
        _unreadable("nutrition_goal", eater, state.entity_id, e)
        return None


class _SyncRepository:
    def __init__(self, engine: SyncEngine):
        self.engine = engine

    async def _run(self, fn, *args):
        return await anyio.to_thread.run_sync(partial(fn, *args))

    def _change(self, entity_type: str, entity_id: str, op: str, fields: dict | None = None,
                parent_id: str | None = None) -> Change:
        # MCP の変更の時刻は、サーバーが受け付けた時刻（エンジンが received_at で切る）
        return Change(str(uuid.uuid4()), entity_type, entity_id, parent_id, op, fields, self.engine.clock(), "mcp")

    def _upsert(self, entity_type: str, entity_id: str, state: EntityState | None, desired: dict,
                parent_id: str | None = None) -> list[Change]:
        if state is None:
            return [self._change(entity_type, entity_id, "create", desired, parent_id)]
        changes = [self._change(entity_type, entity_id, "restore", parent_id=parent_id)] if state.deleted else []
        diff = {k: v for k, v in desired.items() if state.values.get(k, _MISSING) != v}
        if diff:
            changes.append(self._change(entity_type, entity_id, "update", diff, parent_id))
        return changes

    def _write(self, user: str, changes: list[Change]) -> None:
        for change in changes:
            self._check(change)
        if changes:
            self.engine.append(user, changes)

    def _check(self, change: Change) -> None:
        """アプリから届く変更と同じ決まりで確かめる。合わなければ何も書かずに断る（理由は Claude に見せる）。"""
        if change.op not in ("create", "update"):
            return
        registry = self.engine.registry
        result = registry.check_fields(change.entity_type, change.op, change.fields)
        if not isinstance(result, Rejection):
            result = registry.specs[change.entity_type].check(change.entity_id, result)
        if isinstance(result, Rejection):
            details = "、".join(f"{e['field']}：{e['message']}" for e in result.errors)
            raise MealError(f"記録できない値です（{details or result.message}）")


class SyncMealRepository(_SyncRepository):
    async def save(self, meal: Meal) -> None:
        await self._run(self._save, meal)

    def _save(self, meal: Meal) -> None:
        user = meal.eater_id.value
        doc = self.engine.doc(user, "meal", meal.id) or Doc("meal", meal.id)
        changes = self._upsert("meal", meal.id, doc.own, meal_fields(meal))
        for order, item in enumerate(meal.items):
            changes += self._upsert("meal_item", item.id, doc.children.get(item.id),
                                    meal_item_fields(item, order), parent_id=meal.id)
        kept = {i.id for i in meal.items}
        for item_id, child in doc.children.items():
            if item_id not in kept and not child.deleted:
                changes.append(self._change("meal_item", item_id, "delete", parent_id=meal.id))
        self._write(user, changes)

    async def get(self, eater_id: EaterId, meal_id: str) -> Meal | None:
        doc = await self._run(self.engine.doc, eater_id.value, "meal", meal_id)
        return None if doc is None else meal_from_doc(doc, eater_id)

    async def delete(self, eater_id: EaterId, meal_id: str) -> None:
        await self._run(self._write, eater_id.value, [self._change("meal", meal_id, "delete")])

    async def find(self, eater_id: EaterId, start: date, end: date, slot: MealSlot | None = None) -> list[Meal]:
        docs = await self._run(self.engine.docs_by_index, eater_id.value, "meal",
                               day_key(start.isoformat(), SLOT_ORDER[0].value),
                               day_key(end.isoformat(), SLOT_ORDER[-1].value))
        found = [(d, m) for d in docs if (m := meal_from_doc(d, eater_id)) is not None]
        found = [(d, m) for d, m in found if slot is None or m.eaten_on.slot == slot]
        found.sort(key=lambda dm: (dm[1].eaten_on.day, SLOT_ORDER.index(dm[1].eaten_on.slot),
                                   dm[0].own.created_at, dm[1].id))
        return [m for _, m in found]


class SyncMealTemplateRepository(_SyncRepository):
    async def save(self, template: MealTemplate) -> None:
        await self._run(self._save, template)

    def _save(self, template: MealTemplate) -> None:
        user, entity_id = template.eater_id.value, template_id(template.name)
        doc = self.engine.doc(user, "meal_template", entity_id)
        self._write(user, self._upsert("meal_template", entity_id, doc.own if doc else None, template_fields(template)))

    async def get(self, eater_id: EaterId, name: str) -> MealTemplate | None:
        doc = await self._run(self.engine.doc, eater_id.value, "meal_template", template_id(name))
        template = template_from_state(doc.own, eater_id) if doc and doc.own else None
        return template if template and template.name == name else None

    async def list(self, eater_id: EaterId) -> list[MealTemplate]:
        docs = await self._run(self.engine.docs_of_type, eater_id.value, "meal_template")
        docs.sort(key=lambda d: d.own.created_at if d.own else "")
        return [t for d in docs if d.own and (t := template_from_state(d.own, eater_id)) is not None]


class SyncGoalRepository(_SyncRepository):
    async def save(self, goal: NutritionGoal) -> None:
        await self._run(self._save, goal)

    def _save(self, goal: NutritionGoal) -> None:
        user = goal.eater_id.value
        doc = self.engine.doc(user, "nutrition_goal", GOAL_ID)
        self._write(user, self._upsert("nutrition_goal", GOAL_ID, doc.own if doc else None, goal_fields(goal)))

    async def get(self, eater_id: EaterId) -> NutritionGoal | None:
        doc = await self._run(self.engine.doc, eater_id.value, "nutrition_goal", GOAL_ID)
        return goal_from_state(doc.own, eater_id) if doc and doc.own else None


class SyncDayTypeRepository(_SyncRepository):
    async def set(self, eater_id: EaterId, day: date, day_type: DayType) -> None:
        await self._run(self._set, eater_id.value, day.isoformat(), day_type.value)

    def _set(self, user: str, day: str, day_type: str) -> None:
        doc = self.engine.doc(user, "day_type", day)
        self._write(user, self._upsert("day_type", day, doc.own if doc else None, {"day_type": day_type}))

    async def get(self, eater_id: EaterId, day: date) -> DayType | None:
        doc = await self._run(self.engine.doc, eater_id.value, "day_type", day.isoformat())
        if doc is None or doc.own is None or doc.own.deleted or "day_type" not in doc.own.values:
            return None
        return DayType(doc.own.values["day_type"])
