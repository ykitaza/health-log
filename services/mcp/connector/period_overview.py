"""期間の材料を1回で読むツール（period_overview）。レポート（日・週・月のまとめ）を書くチャットが、何度もツールを呼ばずに済むようにする。

筋トレ・食事・体組成・睡眠・心拍・歩数と目標をまとめるので、どのコンテキストにも属さない。中身は各コンテキストのユースケースと出力の形を使い、
ここでは期間を確かめて並べるだけにする（つなぐのは services/mcp/main.py）。
返す量が大きくなりすぎないよう、期間は31日まで、種目は推定1RM の大きい順に20件まで、ケガは10件・振り返りは1件あたり5件まで、
フェーズは5件まで、体組成は体重と体脂肪率だけにする。
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
from sync.read_cache import read_cache_scope
from training.application.queries import TrainingQueries
from training.presentation import mcp_tools as training_tools
from training.presentation import views as training_views

MAX_DAYS = 31  # 1か月が入る長さ
MAX_EXERCISES = 20
MAX_INJURIES = 10  # ケガの一覧（痛めた・振り返った・直している途中）それぞれの件数
MAX_INJURY_REVIEWS = 5  # ケガ1件に付ける期間の振り返りの数（新しい順）
MAX_PHASES = 5  # 期間に重なるフェーズの数（新しい順）


class Settings(Protocol):
    """アプリの設定（同期される）。実装は composition.body_data.SyncedBodyData。"""

    async def goal_settings(self, eater_id: EaterId) -> GoalSettings: ...

    async def weekly_goals(self, eater_id: EaterId) -> dict[str, int | None]: ...


class PreviousNextSteps(Protocol):
    """前の週のまとめの次の一歩と、済んだか。実装は reports.presentation.mcp_tools.PreviousNextSteps。"""

    async def previous_next_steps(self, subject: str, start: date) -> dict | None: ...


class AppSyncStatus(Protocol):
    async def last_app_sync_at(self, subject: str) -> str | None: ...


def register_overview_tools(
    mcp: MCPServer,
    training: TrainingQueries,
    summaries: SummaryService,
    settings: Settings,
    sync_status: AppSyncStatus,
    today: Callable[[], date],
    previous_steps: PreviousNextSteps,
) -> None:
    @mcp.tool(annotations=ToolAnnotations(read_only_hint=True))
    async def period_overview(start: date | None = None, end: date | None = None) -> dict:
        """期間（両端を含む。31日まで）の材料を1回で読む。日・週・月のまとめ（save_report）を書く前に呼ぶ。

        省くと start・end とも今日（日のまとめ）。週は月曜〜日曜、月は月の初日〜最後の日（今月なら今日まで）を渡す。
        - training：筋トレをした日ごとの総負荷量とセット数、合計、種目ごとの期間の最高の推定1RM（大きい順に20件まで）
        - meals：日ごとの kcal・PFC と記録の有無、筋トレの日か、その日の目標 kcal、記録した日の平均と目標との差
        - body：体重・体脂肪率の日ごとの値と期間の平均、end までの28日の体重の週あたりの変化
        - sleep：起きた日ごとの眠っていた時間と寝た・起きた時刻、平均。heart_rate：安静時心拍の日ごとの値と平均
        - steps：日ごとの歩数の合計と、記録がある日の平均（Health Connect の取り込み。記録がない日は含めない）
        - phase：フェーズ（本人がアプリで宣言した、増量 bulk・減量 cut・維持 maintain の期間と療養 rehab）。as_of（end と今日の早いほう）の時点の
          current（今のフェーズ。療養中なら療養）、paused（療養で止まっている通常のフェーズ）、in_period（期間に重なるもの。新しい順に5件）、
          rehab_in_period（期間に療養が重なるか）。通常のフェーズには向き（direction）・何週目（week／weeks_total）・目標体重・
          予定の体重・ペース（pace.status：on_track 順調・fast 早い・slow 遅い、維持は over・under。判定しないときは null と理由）
        - goals：食事の目標（meals）、目標体重（goal_weight_kg。フェーズがあればフェーズの目標体重。どこからかは goal_weight_source：
          phase・setting・meals_goal）、今週の目標（weekly。筋トレの回数・食事を記録する日数・
          7時間以上寝る日数。週の日数で、0 は目標を切っている、null は未設定）
        - injuries：ケガの記録（本人の分析をそのまま）。occurred（期間に痛めたもの）、reviewed（期間に振り返りを書いたもの。
          その振り返りの日付・結果 fixed 直せた・not_yet まだ・pain 痛んだ・メモ・種目）、fixing（end の時点で直している途中のもの）。
          各ケガに部位の名前（左右つき）・種目・場面・症状・原因（cause）・直し方（fix）・状態・直せた日。
          新しい順に10件まで（全部の数は *_total）。原因は推測せず、本人の cause・fix をそのまま使う。診断や治療の助言はしない
        - previous_next_steps：前の週のまとめ（start の7日前〜前の日に終わる weekly）の次の一歩と、利用者がアプリでチェックしたか
          （done）。なければ null。週のまとめは、これを先に振り返ってから次の一歩を書く
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

        # 材料の読み取りは、同じ種類の全件読み（全セット・全体組成・設定・フェーズなど）が何度も重なる
        # （食事のまとめ経由の筋トレ日と period_training で全セットを2回、体組成はフェーズの進み具合を含めて何度もなど）。
        # このツールの1回の実行の間だけ使い回す（戻り値の中身は変えない。読み取り専用なので安全）
        with read_cache_scope():
            catalog = await training.catalog(sub)
            meals = meal_views.weekly(await summaries.period(sub, start, end))
            nutrition_goal = meals.pop("goal")
            for key in ("from", "to"):
                meals.pop(key)
            injuries = training_views.period_injuries(
                await training.injuries(sub), catalog, s, e, MAX_INJURIES, MAX_INJURY_REVIEWS)
            eater = EaterId(sub)
            goal_weight = (await settings.goal_settings(eater)).goal_weight_kg
            as_of = min(end, today()).isoformat()
            listed, current, paused = await training.phase_progresses(sub, as_of, start=s, limit=MAX_PHASES)
            # フェーズ実施中（療養で止まっているときも）は、フェーズの目標体重を先に使う。なければ今までどおり
            normal = paused or (current if current and current.phase.kind == "normal" else None)
            if normal is not None and normal.phase.target_weight_kg is not None:
                goal_weight_kg, goal_source = normal.phase.target_weight_kg, "phase"
            elif goal_weight is not None:
                goal_weight_kg, goal_source = goal_weight, "setting"
            else:
                goal_weight_kg = (nutrition_goal or {}).get("target_weight_kg")
                goal_source = "meals_goal" if goal_weight_kg is not None else None
            return {
                "from": s,
                "to": e,
                "days": (end - start).days + 1,
                "training": training_views.period_training(await training.period_training(sub, s, e), catalog, MAX_EXERCISES),
                "meals": meals,
                "body": training_views.period_body(await training.body_progress(sub, s, e)),
                "sleep": training_views.period_sleep(await training.sleep_summary(sub, s, e)),
                "heart_rate": training_views.period_heart_rate(await training.heart_rate_summary(sub, s, e)),
                "steps": training_views.period_steps(await training.step_summary(sub, s, e)),
                "goals": {
                    "meals": nutrition_goal,
                    # フェーズの目標体重、アプリの設定の目標体重、食事の目標の目標体重の順（後ろの2つは suggest_goals と同じ順）
                    "goal_weight_kg": goal_weight_kg,
                    "goal_weight_source": goal_source,
                    "weekly": await settings.weekly_goals(eater),
                },
                "injuries": injuries,
                "phase": {
                    "as_of": as_of,
                    "current": training_views.phase_brief(current) if current else None,
                    "paused": training_views.phase_brief(paused) if paused else None,
                    "in_period": [training_views.phase_brief(pp) for pp in listed],
                    "rehab_in_period": any(pp.phase.kind == "rehab" for pp in listed),
                },
                "previous_next_steps": await previous_steps.previous_next_steps(sub, start),
                "last_app_sync_at": await sync_status.last_app_sync_at(sub),
            }
