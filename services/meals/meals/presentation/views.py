"""ツールの出力の形。数値は小数第1位で丸める（推定値なので、それ以上の桁は意味がない）。"""

from dataclasses import astuple

from meals.domain.body_weight import GoalProgress
from meals.application.goals import AutoGoal
from meals.domain.auto_goal import FAT_RATIO, MISSING_LABELS, PROTEIN_PER_KG, TRAINING_KCAL, js_round, round1
from meals.domain.meal import Meal
from meals.domain.meal_template import MealTemplate
from meals.domain.nutrition_goal import DailyTarget, NutritionGoal
from meals.domain.summary import DailySummary, WeeklyReview
from meals.domain.nutrition_goal import Target
from meals.domain.values import DayType, Nutrition, NutritionGap

KEYS = ("kcal", "protein_g", "fat_g", "carbs_g")


def nutrition(n: Nutrition | NutritionGap | Target | None) -> dict | None:
    """目標がない項目は None のまま返す。"""
    return None if n is None else dict(zip(KEYS, (None if v is None else round(v, 1) for v in astuple(n))))


def meal(m: Meal) -> dict:
    return {
        "meal_id": m.id,
        "date": m.eaten_on.day.isoformat(),
        "slot": m.eaten_on.slot.value,
        "time": m.eaten_on.at.strftime("%H:%M") if m.eaten_on.at else None,
        "description": m.description,
        "source": m.source.value,
        "basis": m.basis or None,  # kcal と PFC を推定したときの根拠。なければ null
        "items": [
            {
                "item_id": i.id,
                "name": i.name,
                "amount": i.quantity.amount,
                "unit": i.quantity.unit.value,
                **nutrition(i.nutrition),
                "confidence": i.confidence.value,
            }
            for i in m.items
        ],
        "total": nutrition(m.total()),
    }


def template(t: MealTemplate) -> dict:
    return {"name": t.name, "items": [{"name": i.name, "amount": i.quantity.amount, "unit": i.quantity.unit.value}
                                      for i in t.items]}


def goal(g: NutritionGoal) -> dict:
    return {
        "policy": g.policy.value,
        "body_weight_kg": g.body_weight_kg,
        "protein_per_kg": g.protein_per_kg,
        "training_day": nutrition(g.target_for(DayType.TRAINING)),
        "rest_day": nutrition(g.target_for(DayType.REST)),
        "eating_style": g.eating_style.value if g.eating_style else None,
        "target_weight_kg": g.target_weight_kg,
    }


def goal_fields(g: NutritionGoal) -> dict:
    """アプリ用の API の目標の形（docs/api/app-api.yaml の NutritionGoalFields）。アプリはそのまま同期で送れる。

    MCP の goal（日の種類ごとの目標。たんぱく質を含む）とは別の形。
    """
    both = g.training_day is not None and g.rest_day is not None
    return {
        "policy": g.policy.value, "body_weight_kg": g.body_weight_kg, "protein_per_kg": g.protein_per_kg,
        "targets": {"training_day": _daily_target(g.training_day), "rest_day": _daily_target(g.rest_day)}
        if both else None,
        "eating_style": g.eating_style.value if g.eating_style else None,
        "target_weight_kg": g.target_weight_kg,
    }


def _daily_target(t: DailyTarget | None) -> dict | None:
    return None if t is None else {"kcal": t.kcal, "fat_g": t.fat_g, "carbs_g": t.carbs_g}


def daily(s: DailySummary) -> dict:
    view = {
        "date": s.day.isoformat(),
        "day_type": s.day_type.value,
        "meals": [{"meal_id": m.id, "slot": m.eaten_on.slot.value, "description": m.description,
                   "name": "、".join(i.name for i in m.items), "kcal": round(m.total().kcal, 1)} for m in s.meals],
        "total": nutrition(s.total),
        "goal": goal(s.goal) if s.goal else None,  # 方針だけの目標もある（そのときは target の数字が null）
        "target": nutrition(s.target),
        "remaining": nutrition(s.remaining),
    }
    if s.goal is None:
        view["note"] = "目標が未設定です。利用者に方針（増量・減量・維持）と体重などを聞いて set_goals を呼んでください"
    return view


def weekly(r: WeeklyReview) -> dict:
    return {
        "from": r.days[0].day.isoformat(),
        "to": r.days[-1].day.isoformat(),
        "goal": goal(r.days[-1].goal) if r.days[-1].goal else None,
        "recorded_days": len(r.recorded_days),
        "total_days": len(r.days),
        "average_of_recorded_days": nutrition(r.average),
        "average_target": nutrition(r.average_target),
        "gap": nutrition(r.gap),
        "days": [
            {
                "date": d.day.isoformat(),
                "day_type": d.day_type.value,
                "recorded": bool(d.meals),
                **nutrition(d.total),
                "target_kcal": d.target.kcal if d.target else None,
            }
            for d in r.days
        ],
    }


def progress(p: GoalProgress) -> dict:
    def kg(value: float | None, digits: int = 1) -> float | None:
        return None if value is None else round(value, digits)

    return {
        "policy": p.goal.policy.value if p.goal else None,
        "target_kg": p.target_kg,
        "latest": {"date": p.latest.day.isoformat(), "kg": p.latest.kg} if p.latest else None,
        "remaining_kg": kg(p.remaining_kg),
        "weekly_change_kg": kg(p.weekly_change_kg, 2),
        "weeks_to_goal": kg(p.weeks_to_goal),
        "on_track": p.on_track,
        "records": [{"date": r.day.isoformat(), "kg": r.kg} for r in p.records],
    }


FORMULAS = {"katch-mcardle": "Katch-McArdle の式（370 + 21.6 × 除脂肪体重）",
            "mifflin-st-jeor": "Mifflin-St Jeor の式（10 × 体重 + 6.25 × 身長 − 5 × 年齢 + 男性 5／女性 −161）"}
NOT_MEDICAL = "一般的な目安で、医療のための計算ではありません"


def _missing_message(missing: tuple[str, ...]) -> str:
    if missing == ("weight",):
        return "体重の記録がありません。体重を記録して（record_weight か、アプリで記録して同期）から、もう一度計算してください"
    parts = []
    ask = [MISSING_LABELS[m] for m in missing if m in ("sex", "birth_year")]
    if ask:
        parts.append(f"{'と'.join(ask)}を教えてください（直近7日に体脂肪率の記録がないので、基礎代謝を Mifflin-St Jeor の式で"
                     "計算します。計算に使うだけで、保存しません）")
    settings = [MISSING_LABELS[m] for m in missing if m in ("height", "activity")]
    if settings:
        parts.append(f"アプリの設定で{'と'.join(settings)}を入れて同期してから、もう一度計算してください")
    return "。".join(parts)


_HOW = {
    "weight": "体重を記録する（record_weight か、アプリで記録して同期）",
    "sex": "本人に聞いて、引数の sex（male か female）で渡す（保存しない）",
    "birth_year": "本人に聞いて、引数の birth_year（西暦）で渡す（保存しない）",
    "height": "アプリの設定で身長を入れて同期してもらう",
    "activity": "アプリの設定で活動の量を選んで同期してもらう",
}


def auto_goal(r: AutoGoal) -> dict:
    """目標の自動計算の結果（アプリの「計算のもと」と同じ項目）。足りない入力があれば、それを返す。"""
    if r.missing:
        return {"status": "needs_input", "message": _missing_message(r.missing),
                "missing": [{"item": m, "label": MISSING_LABELS[m], "how": _HOW[m]} for m in r.missing]}
    c, b, activity = r.calc, r.basis, r.settings.activity

    def target(t) -> dict:
        return {"kcal": t.kcal, "protein_g": c.protein_g, "fat_g": t.fat_g, "carbs_g": t.carbs_g}

    notes = [NOT_MEDICAL]
    if r.target_weight_kg is None:
        notes.append("目標体重がアプリの設定にも今の目標にもないので、維持で計算しました（目標体重はアプリの設定で入れられます）")
    elif r.settings.goal_weight_kg is None:
        notes.append("目標体重はアプリの設定にないので、今の目標の目標体重を使いました")
    if c.floored:
        notes.append("基礎代謝を下回らないように、kcal の目標を引き上げました")
    if c.bmr_method == "mifflin-st-jeor":
        notes.append("性別と生まれた年は計算に使っただけで、保存していません")
    return {
        "status": "ok",
        "training_day": target(c.training),
        "rest_day": target(c.rest),
        "basis": {
            "weight": {"kg": c.body_weight_kg, "from": b.weight_from.isoformat(), "to": b.weight_to.isoformat(),
                       "days": b.weight_days},
            "body_fat": None if b.body_fat is None else {
                "pct": round1(b.body_fat.pct), "from": b.body_fat.start.isoformat(), "to": b.body_fat.end.isoformat(),
                "days": b.body_fat.days},
            "bmr_formula": FORMULAS[c.bmr_method],
            "bmr_kcal": js_round(c.bmr),
            "tdee_kcal": {"rest_day": js_round(c.tdee_rest), "training_day": js_round(c.tdee_training)},
            "activity": {"level": activity.value, "label": activity.label, "factor": activity.factor},
            "training_day_extra_kcal": TRAINING_KCAL,
            "policy": c.policy.value,
            "target_weight_kg": r.target_weight_kg,
            "weekly_change_kg": js_round(c.weekly_kg * 100) / 100,
            "daily_delta_kcal": js_round(c.daily_delta),
            "protein": {"per_kg": PROTEIN_PER_KG, "g": c.protein_g},
            "fat_ratio": FAT_RATIO,
            "floored": c.floored,
        },
        "notes": notes,
    }


def auto_goal_fields(r: AutoGoal) -> dict | None:
    """自動計算の案を、保存する目標の形（goal_fields と同じ）にする。足りない入力があれば None。"""
    if r.calc is None:
        return None
    c = r.calc
    style = r.current.eating_style if r.current else None  # 食事の傾向は今の目標のまま（アプリと同じ）
    return {
        "policy": c.policy.value, "body_weight_kg": c.body_weight_kg, "protein_per_kg": PROTEIN_PER_KG,
        "targets": {"training_day": _daily_target(c.training), "rest_day": _daily_target(c.rest)},
        "eating_style": style.value if style else None,
        "target_weight_kg": r.target_weight_kg,
    }
