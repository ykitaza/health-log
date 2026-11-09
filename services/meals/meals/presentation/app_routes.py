"""アプリ用の API の、食事のルート（同期でないもの）。同期の入口（sync.presentation.http_api）に足して使う。

  POST /v1/meals/goal-suggestions   目標の案を計算する（保存しない。MCP の suggest_goals と同じ計算）
"""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Callable, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from meals.application.goals import GoalService
from meals.domain.auto_goal import Sex
from meals.domain.errors import MealError
from meals.presentation.views import auto_goal, auto_goal_fields
from sync.presentation.http_api import Caller, HttpError, Route, field_errors, parse_body


class GoalSuggestionRequest(BaseModel):
    """性別と生まれた年は、体脂肪率がないとき（Mifflin-St Jeor）だけ使う。計算に使うだけで保存しない。"""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    sex: Literal["male", "female"] | None = None
    birth_year: int | None = None  # 範囲（15〜100歳）はドメインが確かめる


def meal_routes(goals: GoalService, today: Callable[[], date]) -> dict[tuple[str, str], Route]:
    def suggest_goals(caller: Caller, event: dict) -> dict:
        if not caller.can("meals", "read"):  # オーソライザーでも確かめている
            raise HttpError(403, "forbidden", "torelog-api/meals.read が要ります")
        try:
            req = GoalSuggestionRequest.model_validate(parse_body(event))
        except ValidationError as e:
            raise HttpError(400, "invalid-request", "本文の形が違います", field_errors(e)) from e
        try:  # 範囲の決まりは、ドメインが確かめる（MCP と同じ文で返す）
            result = asyncio.run(goals.suggest(caller.user, today(), Sex(req.sex) if req.sex else None, req.birth_year))
        except MealError as e:
            raise HttpError(422, "domain-rule", str(e)) from e
        return {**auto_goal(result), "goal": auto_goal_fields(result)}

    return {("POST", "/v1/meals/goal-suggestions"): suggest_goals}
