"""MCP のツールを、通信を通さずに呼んで確かめる。アクセストークンは検証済みのものに差し替える。"""

import asyncio
import json
from datetime import date

import pytest
from mcp.server.auth.provider import AccessToken
from mcp.server.mcpserver.exceptions import ToolError

from meals.application.goals import GoalService
from meals.application.meals import MealService
from meals.application.summaries import SummaryService
from meals.application.templates import TemplateService
from meals.application.weights import WeightService
from meals.domain.auto_goal import Activity, BodyDay
from meals.domain.ports import GoalSettings
from meals.domain.values import EaterId
from meals.infrastructure import memory_repositories as memory
from meals.infrastructure.subject_as_eater_id import SubjectAsEaterId
from meals.presentation import mcp_server
from mcp.server.mcpserver import MCPServer

from meals.presentation.mcp_server import Services, register_meal_tools

TODAY = date(2026, 10, 12)
LUNCH = {
    "date": "2026-10-12",
    "slot": "lunch",
    "items": [
        {"name": "白米", "amount": 200, "unit": "g", "kcal": 312, "protein_g": 5, "fat_g": 0.6, "carbs_g": 74},
        {"name": "鶏むね肉", "amount": 100, "unit": "g", "kcal": 108, "protein_g": 22, "fat_g": 1.5, "carbs_g": 0},
    ],
    "description": "白米と鶏むね肉",
    "source": "photo",
}
GOALS = {
    "policy": "bulk",
    "body_weight_kg": 70,
    "protein_per_kg": 2.0,
    "training_day": {"kcal": 2800, "fat_g": 70, "carbs_g": 380},
    "rest_day": {"kcal": 2400, "fat_g": 70, "carbs_g": 280},
}


class FakeSession:
    def __init__(self):
        self.revoked = []

    async def revoke(self, access_token, client_id):
        self.revoked.append((access_token, client_id))

    def logout_url(self):
        return "https://authz.example/logout"


@pytest.fixture
def call(monkeypatch):
    token = AccessToken(token="t", client_id="c", scopes=["meals:read", "meals:write"], subject="alice")
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: token)
    eaters, meals, body = SubjectAsEaterId(), memory.InMemoryMealRepository(), memory.InMemoryBodyData()
    goals, day_types = memory.InMemoryGoalRepository(), memory.InMemoryDayTypeRepository()
    services = Services(
        MealService(eaters, meals),
        TemplateService(eaters, meals, memory.InMemoryMealTemplateRepository()),
        GoalService(eaters, goals, day_types, body),
        SummaryService(eaters, meals, goals, day_types),
        WeightService(eaters, memory.InMemoryWeightRepository(), goals),
    )
    session = FakeSession()
    mcp = MCPServer(name="test")  # サーバーと認証は組み立ての場所（services/mcp）が作る
    register_meal_tools(mcp, services, today=lambda: TODAY)

    def _call(tool: str, **arguments):
        result = asyncio.run(mcp.call_tool(tool, arguments))
        return json.loads(result.content[0].text)

    _call.mcp, _call.session, _call.body = mcp, session, body
    return _call


def test_記録すると食事と今日の状況を返す(call):
    result = call("record_meal", meal=LUNCH)
    assert result["meals"][0]["total"] == {"kcal": 420, "protein_g": 27, "fat_g": 2.1, "carbs_g": 74}
    assert result["today"]["total"]["kcal"] == 420
    assert "目標が未設定" in result["today"]["note"]


def test_目標を決めると残りが出る(call):
    call("set_goals", **GOALS)
    call("record_meal", meal=LUNCH)
    assert call("today_status")["remaining"] == {"kcal": 1980, "protein_g": 113, "fat_g": 67.9, "carbs_g": 206}
    assert call("set_day_type", day_type="training")["remaining"]["kcal"] == 2380


def test_量を直すと栄養も変わる(call):
    meal = call("record_meal", meal=LUNCH)["meals"][0]
    rice = meal["items"][0]["item_id"]
    updated = call("update_meal", meal_id=meal["meal_id"], change_amounts=[{"item_id": rice, "amount": 100}])
    assert updated["meals"][0]["items"][0]["kcal"] == 156


def test_いつものと昨日と同じ(call):
    meal = call("record_meal", meal=LUNCH)["meals"][0]
    call("save_template", meal_id=meal["meal_id"], name="いつもの昼")
    tomorrow = {"date": "2026-10-13", "slot": "lunch"}
    assert call("record_template", name="いつもの昼", when=tomorrow)["meals"][0]["source"] == "template"
    assert call("copy_meal", meal_id=meal["meal_id"], to=tomorrow)["meals"][0]["source"] == "copy"
    assert len(call("list_meals", start="2026-10-13", end="2026-10-13")["meals"]) == 2


def test_ドメインの決まりに反すると理由を返す(call):
    meal = call("record_meal", meal={**LUNCH, "items": LUNCH["items"][:1]})["meals"][0]
    with pytest.raises(ToolError, match="最後の品目"):
        call("update_meal", meal_id=meal["meal_id"], remove_item_ids=[meal["items"][0]["item_id"]])



def test_品目は1回の食事に50件まで(call):
    item = LUNCH["items"][0]
    with pytest.raises(ToolError):
        call("record_meal", meal={**LUNCH, "items": [item] * 51})
    with pytest.raises(ToolError):
        call("record_meals", meals=[{**LUNCH, "items": [item] * 51}])
    meal = call("record_meal", meal={**LUNCH, "items": [item] * 50})["meals"][0]
    with pytest.raises(ToolError):
        call("update_meal", meal_id=meal["meal_id"], add_items=[item] * 51)
    with pytest.raises(ToolError, match="50件"):
        call("update_meal", meal_id=meal["meal_id"], add_items=[item])


def test_食事の一覧の期間は366日まで(call):
    assert call("list_meals", start="2025-10-12", end="2026-10-12")["meals"] == []  # 366日
    with pytest.raises(ToolError, match="366日"):
        call("list_meals", start="2025-10-11", end="2026-10-12")


def test_週のふり返りは月曜から_今週は今日まで(call):
    call("record_meal", meal=LUNCH)  # 今日（月曜）
    call("record_meal", meal={**LUNCH, "date": "2026-10-11"})  # 先週の日曜
    review = call("weekly_review")
    assert (review["from"], review["to"], review["recorded_days"], review["total_days"]) == (
        "2026-10-12", "2026-10-12", 1, 1)
    last_week = call("weekly_review", day="2026-10-08")
    assert (last_week["from"], last_week["to"], last_week["recorded_days"]) == ("2026-10-05", "2026-10-11", 1)


def test_期間の食事のまとめ_月のふり返り(call):
    call("set_goals", **GOALS)
    call("record_meal", meal={**LUNCH, "date": "2026-09-01"})
    call("record_meal", meal={**LUNCH, "date": "2026-09-30"})
    month = call("meal_summary", start="2026-09-01", end="2026-09-30")
    assert (month["from"], month["to"], month["total_days"], month["recorded_days"]) == (
        "2026-09-01", "2026-09-30", 30, 2)
    assert month["average_of_recorded_days"]["kcal"] == 420 and month["goal"]["policy"] == "bulk"
    assert month["days"][0] == {"date": "2026-09-01", "day_type": "rest", "recorded": True, "kcal": 420,
                                "protein_g": 27, "fat_g": 2.1, "carbs_g": 74, "target_kcal": 2400}
    assert month["last_app_sync_at"] is None


def test_週と期間のまとめの説明():
    mcp = MCPServer(name="test")
    register_meal_tools(mcp, None, today=lambda: TODAY)
    tools = {t.name: t for t in asyncio.run(mcp.list_tools())}
    assert "月曜〜日曜" in tools["weekly_review"].description
    assert "31日まで" in tools["meal_summary"].description and "月のふり返り" in tools["meal_summary"].description


def test_期間の食事のまとめは31日まで(call):
    assert call("meal_summary", start="2026-08-01", end="2026-08-31")["total_days"] == 31
    with pytest.raises(ToolError, match="31日"):
        call("meal_summary", start="2026-08-01", end="2026-09-01")
    with pytest.raises(ToolError, match="end は start"):
        call("meal_summary", start="2026-09-02", end="2026-09-01")


def body_data(call, days, height=175, goal_weight=72, activity=Activity.MODERATE):
    call.body.days[EaterId("alice")] = [BodyDay(date.fromisoformat(d), w, f) for d, w, f in days]
    call.body.settings[EaterId("alice")] = GoalSettings(height, goal_weight, activity)


def test_目標の案は保存せず_本人が決めたら_そのまま_set_goals_に渡せる(call):
    body_data(call, [("2026-10-11", 80.0, 20.0), ("2026-10-12", 80.0, None)])
    suggestion = call("suggest_goals")
    assert suggestion["status"] == "ok"
    assert suggestion["rest_day"] == {"kcal": 2300, "protein_g": 160, "fat_g": 64, "carbs_g": 271}
    assert suggestion["training_day"]["kcal"] == 2580
    assert suggestion["basis"] == {
        "weight": {"kg": 80.0, "from": "2026-10-11", "to": "2026-10-12", "days": 2},
        "body_fat": {"pct": 20.0, "from": "2026-10-11", "to": "2026-10-11", "days": 1},
        "bmr_formula": "Katch-McArdle の式（370 + 21.6 × 除脂肪体重）", "bmr_kcal": 1752,
        "tdee_kcal": {"rest_day": 2716, "training_day": 2996},
        "activity": {"level": "moderate", "label": "よく動く", "factor": 1.55}, "training_day_extra_kcal": 280,
        "policy": "cut", "target_weight_kg": 72, "weekly_change_kg": -0.4, "daily_delta_kcal": -411,
        "protein": {"per_kg": 2.0, "g": 160}, "fat_ratio": 0.25, "floored": False,
    }
    assert any("医療" in n for n in suggestion["notes"])
    assert "note" in call("today_status")  # まだ保存していない
    call("set_goals", **suggestion["set_goals_arguments"])
    assert call("today_status")["target"]["kcal"] == 2300


def test_体脂肪率がなければ性別と生まれた年を聞くよう返し_渡せば計算する(call):
    body_data(call, [("2026-10-12", 70.0, None)], goal_weight=70)
    asked = call("suggest_goals")
    assert asked["status"] == "needs_input" and "性別と生まれた年を教えてください" in asked["message"]
    assert [m["item"] for m in asked["missing"]] == ["sex", "birth_year"]
    assert "set_goals_arguments" not in asked
    # 10×70 + 6.25×175 − 5×30 + 5 = 1648.75。× 1.55 ≒ 2555.6 → 2560
    result = call("suggest_goals", sex="male", birth_year=1996)
    assert result["status"] == "ok" and result["rest_day"]["kcal"] == 2560
    assert result["basis"]["bmr_formula"].startswith("Mifflin-St Jeor")
    assert any("保存していません" in n for n in result["notes"])
    assert "1996" not in json.dumps(result) and "male" not in json.dumps(result["set_goals_arguments"])  # 返しも保存もしない


def test_設定が足りなければ_足りないものを返す(call):
    body_data(call, [("2026-10-12", 70.0, None)], height=None, goal_weight=None, activity=None)
    result = call("suggest_goals", sex="female", birth_year=1990)
    assert [m["item"] for m in result["missing"]] == ["height", "activity"]
    assert "アプリの設定で身長と活動の量を入れて" in result["message"]
    body_data(call, [])
    assert [m["item"] for m in call("suggest_goals")["missing"]] == ["weight"]


def test_目標体重がなければ維持で計算し_そう伝える(call):
    body_data(call, [("2026-10-12", 70.0, 15.0)], goal_weight=None)
    result = call("suggest_goals")
    assert result["basis"]["policy"] == "maintain" and result["set_goals_arguments"]["target_weight_kg"] is None
    assert any("維持で計算しました" in n for n in result["notes"])
    call("set_goals", policy="bulk", target_weight_kg=75, eating_style="eating_out")
    again = call("suggest_goals")  # 設定になければ今の目標の目標体重を使い、食事の傾向も今の目標のまま
    assert again["basis"]["policy"] == "bulk"
    assert (again["set_goals_arguments"]["target_weight_kg"], again["set_goals_arguments"]["eating_style"]) == (75, "eating_out")


def test_生まれた年が範囲外なら理由を返す(call):
    body_data(call, [("2026-10-12", 70.0, None)])
    with pytest.raises(ToolError, match="生まれた年は 1926〜2011"):
        call("suggest_goals", sex="male", birth_year=2020)


def test_方針だけでも目標を設定できる(call):
    call("set_goals", policy="maintain")
    status = call("today_status")
    assert "note" not in status and status["remaining"]["kcal"] is None


def test_体重を記録すると道のりを返し_目標体重までの残りが出る(call):
    call("set_goals", policy="bulk", target_weight_kg=70)
    call("record_weight", kg=66.0, day="2026-09-28")
    result = call("record_weight", kg=67.0)  # 今日
    assert (result["latest"]["kg"], result["remaining_kg"], result["weekly_change_kg"]) == (67.0, 3.0, 0.5)
    assert result["weeks_to_goal"] == 6.0 and result["on_track"] is True
    assert len(call("goal_progress")["records"]) == 2


def test_結果に次の提案がある(call):
    assert call("record_meal", meal=LUNCH)["suggested_next"]
    week = call("weekly_review")
    assert week["suggested_next"] and week["days"][-1]["recorded"] is True


def test_方針だけの目標も今日と週の結果に出る(call):
    call("set_goals", policy="bulk")
    assert call("today_status")["goal"]["policy"] == "bulk"
    assert call("weekly_review")["goal"]["policy"] == "bulk"
