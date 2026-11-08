"""アプリ用の API の、食事のルート（同期でないもの）。同期の入口（sync.presentation.http_api）に足して使う。

  POST /v1/meals/goal-suggestions   目標の案を計算する（保存しない。MCP の suggest_goals と同じ計算）
"""

from __future__ import annotations

import asyncio
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from application.goals import GoalService
from domain.errors import MealError
from domain.goal_suggestion import BodyProfile, DailyActivity, GoalPlan, Sex
from domain.nutrition_goal import EatingStyle, Policy
from infrastructure.sync_repositories import goal_fields
from presentation.views import used_inputs
from sync.presentation.http_api import Caller, HttpError, Route, field_errors, parse_body


class GoalSuggestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    policy: Literal["bulk", "maintain", "cut"]
    pace_kg_per_week: Annotated[float, Field(ge=0, le=1)] = 0
    protein_per_kg: Annotated[float, Field(ge=1, le=3)] = 2.0
    sex: Literal["male", "female", "unspecified"] = "unspecified"
    age: Annotated[int, Field(ge=1, le=120)] | None = None
    height_cm: Annotated[float, Field(gt=0, le=300)] | None = None
    weight_kg: Annotated[float, Field(gt=0, le=300)] | None = None
    daily_activity: Literal["low", "moderate", "high"] | None = None
    training_minutes: Annotated[int, Field(ge=0, le=600)] | None = None
    eating_style: Literal["home_cooked", "eating_out", "convenience_store"] | None = None
    target_weight_kg: Annotated[float, Field(ge=30, le=300)] | None = None


def meal_routes(goals: GoalService) -> dict[tuple[str, str], Route]:
    def suggest_goals(caller: Caller, event: dict) -> dict:
        if not caller.can("meals", "read"):  # オーソライザーでも確かめている
            raise HttpError(403, "forbidden", "torelog-api/meals.read が要ります")
        try:
            req = GoalSuggestionRequest.model_validate(parse_body(event))
        except ValidationError as e:
            raise HttpError(400, "invalid-request", "本文の形が違います", field_errors(e)) from e
        try:  # 範囲や組み合わせの決まりは、ドメインが確かめる（MCP と同じ文で返す）
            profile = BodyProfile(Sex(req.sex), req.age, req.height_cm, req.weight_kg,
                                  DailyActivity(req.daily_activity) if req.daily_activity else None,
                                  req.training_minutes)
            plan = GoalPlan(Policy(req.policy), req.pace_kg_per_week, req.protein_per_kg,
                            EatingStyle(req.eating_style) if req.eating_style else None, req.target_weight_kg)
            suggestion = asyncio.run(goals.suggest(caller.user, profile, plan))
        except MealError as e:
            raise HttpError(422, "domain-rule", str(e)) from e
        return {"goal": goal_fields(suggestion.goal), "notes": list(suggestion.notes), "used": used_inputs(profile)}

    return {("POST", "/v1/meals/goal-suggestions"): suggest_goals}
