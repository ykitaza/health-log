"""期間の材料を1回で読むツール（period_overview）。レポート（日・週・月のまとめ）を書くチャットが、何度もツールを呼ばずに済むようにする。

筋トレ・食事・体組成・睡眠・心拍と目標をまとめるので、どのコンテキストにも属さない。中身は各コンテキストのユースケースと出力の形を使い、
ここでは期間を確かめて並べるだけにする（つなぐのは services/mcp/main.py）。
返す量が大きくなりすぎないよう、期間は31日まで、種目は推定1RM の大きい順に20件まで、体組成は体重と体脂肪率だけにする。
"""

from __future__ import annotations

from datetime import date
from typing import Callable, Protocol

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations

from meals.application.summaries import SummaryService
from meals.domain.ports import GoalSettings
from meals.domain.values import EaterId
from meals.presentation import views as meal_views
from training.application.queries import TrainingQueries
from training.presentation import mcp_tools as training_tools
from training.presentation import views as training_views

MAX_DAYS = 31  # 1か月が入る長さ
MAX_EXERCISES = 20


class Settings(Protocol):
    """アプリの設定（同期される）。実装は composition.body_data.SyncedBodyData。"""

    async def goal_settings(self, eater_id: EaterId) -> GoalSettings: ...

    async def weekly_goals(self, eater_id: EaterId) -> dict[str, int | None]: ...


class AppSyncStatus(Protocol):
    async def last_app_sync_at(self, subject: str) -> str | None: ...


def register_overview_tools(
    mcp: MCPServer,
    training: TrainingQueries,
    summaries: SummaryService,
    settings: Settings,
    sync_status: AppSyncStatus,
    today: Callable[[], date],
) -> None:
    @mcp.tool(annotations=ToolAnnotations(read_only_hint=True))
    async def period_overview(start: date | None = None, end: date | None = None) -> dict:
        """期間（両端を含む。31日まで）の材料を1回で読む。日・週・月のまとめ（save_report）を書く前に呼ぶ。

        省くと start・end とも今日（日のまとめ）。週は月曜〜日曜、月は月の初日〜最後の日（今月なら今日まで）を渡す。
        - training：筋トレをした日ごとの総負荷量とセット数、合計、種目ごとの期間の最高の推定1RM（大きい順に20件まで）
        - meals：日ごとの kcal・PFC と記録の有無、筋トレの日か、その日の目標 kcal、記録した日の平均と目標との差
        - body：体重・体脂肪率の日ごとの値と期間の平均、end までの28日の体重の週あたりの変化
        - sleep：起きた日ごとの眠っていた時間と寝た・起きた時刻、平均。heart_rate：安静時心拍の日ごとの値と平均
        - goals：食事の目標（meals）、目標体重（goal_weight_kg）、今週の目標（weekly。筋トレの回数・食事を記録する日数・
          7時間以上寝る日数。週の日数で、0 は目標を切っている、null は未設定）
        数字はこの結果の値だけを使い、推測で作らない。達成の数字（目標に対する回数など）はアプリが記録から計算して見せるので、
        レポートには書かなくてよい。もっとくわしい記録は、それぞれのツール（get_workout、list_meals など）で読む。
        """
        token = get_access_token()
        if token is None or training_tools.READ_SCOPE not in token.scopes:
            raise ToolError(
                f"筋トレの記録を読む許可（{training_tools.READ_SCOPE}）がありません。筋トレのツールを足す前につないだコネクタです。"
                "利用者に、コネクタの連携をいったん解除してつなぎ直し、同意画面で許可するよう伝えてください。")
        sub = token.subject
        end = end or today()
        start = start or end
        if end < start:
            raise ToolError("end は start と同じか後の日にしてください")
        if (end - start).days >= MAX_DAYS:
            raise ToolError(f"期間は{MAX_DAYS}日までにしてください")
        s, e = start.isoformat(), end.isoformat()

        catalog = await training.catalog(sub)
        meals = meal_views.weekly(await summaries.period(sub, start, end))
        nutrition_goal = meals.pop("goal")
        for key in ("from", "to"):
            meals.pop(key)
        eater = EaterId(sub)
        goal_weight = (await settings.goal_settings(eater)).goal_weight_kg
        return {
            "from": s,
            "to": e,
            "days": (end - start).days + 1,
            "training": training_views.period_training(await training.period_training(sub, s, e), catalog, MAX_EXERCISES),
            "meals": meals,
            "body": training_views.period_body(await training.body_progress(sub, s, e)),
            "sleep": training_views.period_sleep(await training.sleep_summary(sub, s, e)),
            "heart_rate": training_views.period_heart_rate(await training.heart_rate_summary(sub, s, e)),
            "goals": {
                "meals": nutrition_goal,
                # アプリの設定の目標体重。なければ食事の目標の目標体重（suggest_goals と同じ順）
                "goal_weight_kg": goal_weight if goal_weight is not None
                else (nutrition_goal or {}).get("target_weight_kg"),
                "weekly": await settings.weekly_goals(eater),
            },
            "last_app_sync_at": await sync_status.last_app_sync_at(sub),
        }
