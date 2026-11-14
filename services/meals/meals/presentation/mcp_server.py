"""MCP の入口（食事のツール）。ツールの説明文は Claude（ChatGPT）への指示を兼ねる。

ここはツールを登録するだけで、サーバー（MCPServer）と認証は作らない。食事と筋トレのツールを1つのサーバーに
まとめるのは、組み立ての場所（services/mcp/main.py）。
"""

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Annotated, Callable, Protocol

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import Field

from meals.application.commands import MealChanges
from meals.application.goals import GoalService
from meals.application.meals import MealService
from meals.application.summaries import SummaryService, week_start
from meals.application.templates import TemplateService
from meals.application.weights import WeightService
from meals.domain.errors import MealError
from meals.domain.auto_goal import Sex
from meals.domain.meal import MAX_ITEMS
from meals.domain.nutrition_goal import DailyTarget, EatingStyle, NutritionGoal, Policy
from meals.domain.values import DayType, EaterId, MealSlot
from meals.presentation import views
from meals.presentation.schemas import (
    AmountChange,
    BodyWeightKg,
    DailyTargetInput,
    ItemInput,
    MealInput,
    ProteinPerKg,
    SlotName,
    TemplateName,
    WhenInput,
)

# 一度に読める期間（筋トレの MAX_RANGE_DAYS と同じ）。長い期間で一度に読みすぎないようにする
MAX_RANGE_DAYS = 366
# 食事のまとめ（meal_summary）で一度に読める日数。1か月が入る長さ
MAX_SUMMARY_DAYS = 31

# 食事のツールに要る scope。組み立ての場所が、接続（HTTP）のところで両方を必須にする（足りなければ SDK が 403）
READ_SCOPE, WRITE_SCOPE = "meals:read", "meals:write"

INSTRUCTIONS = """食事を記録し、カロリーと PFC（たんぱく質・脂質・炭水化物）を目標と比べるサーバー。
記録の流れ：写真か言葉から品目と量と栄養を推定し、表にして「この内容で記録してよいですか？」とだけ聞く。
ほかの質問（調味料・油など）はしない。了承を得てから record_meal を呼ぶ。直したい点があれば直してから記録する。
「いつもの」「昨日と同じ」、数値だけの記録は、中身が分かっているので確認なしで記録してよい。
記録したら、返ってきた today の残りを一言で伝える。目標を守れたかどうかで利用者を責めない。
目標を決める・変えるときは suggest_goals を呼ぶ（体組成の記録とアプリの設定から計算する）。性別・生まれた年などを推測で埋めてはいけない。
結果の goal が null なら目標は未設定。goal があって target の数字が null なら、方針だけの目標がある（未設定と言わない）。
結果に suggested_next があれば、返事の最後にその中から1つだけ次の操作として提案する。
見せ方は任せる。利用者の好み：数字は表やグラフで見やすく。PFC は割合（%）とグラム数の両方（円グラフがよい）。
週の kcal や体重の推移など、日ごとに変わる数字には、描けるならグラフを付ける（描けないときは表で返す）。
入力してもらうときは、使えるならフォームや選択肢で聞く。
日の種類（筋トレの日／休みの日）は、本人が set_day_type で決めた日はそれを、決めていない日は、その日に筋トレの記録があれば筋トレの日にする。"""

READ = ToolAnnotations(read_only_hint=True)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False)
DESTRUCTIVE = ToolAnnotations(read_only_hint=False, destructive_hint=True)

# 次の操作の候補。Claude・ChatGPT が返事の最後に1つ提案する（見せ方や案内は AI に任せる）
NEXT_WEEK = "今週の食事をふり返る"
NEXT_PROGRESS = "ゴールまでの道のりを見る"
NEXT_TODAY = "今日の状況を見る"
NEXT_WEIGHT = "体重を記録する"


class AppSyncStatus(Protocol):
    """アプリの最後の同期の時刻（同期の仕組みが持つ）。組み立ての場所でつなぐ。"""

    async def last_app_sync_at(self, subject: str) -> str | None:
        """その人の端末からの変更を、最後に受け付けた時刻。まだなければ None。"""
        ...


class PreviousNextSteps(Protocol):
    """前の週のまとめの次の一歩と、それぞれ済んだか（レポートが持つ）。組み立ての場所でつなぐ。"""

    async def previous_next_steps(self, subject: str, start: date) -> dict | None:
        """start の前の週のまとめの次の一歩（なければ None）。"""
        ...


class NoAppSync:
    """同期をつながないとき（テストなど）。"""

    async def last_app_sync_at(self, subject: str) -> str | None:
        return None


@dataclass(frozen=True)
class Services:
    meals: MealService
    templates: TemplateService
    goals: GoalService
    summaries: SummaryService
    weights: WeightService


def register_meal_tools(
    mcp: MCPServer,
    services: Services,
    today: Callable[[], date],
    sync_status: AppSyncStatus | None = None,
    previous_steps: PreviousNextSteps | None = None,
) -> None:
    """食事のツールを mcp に登録する。previous_steps をつなぐと、weekly_review に前の週のまとめの次の一歩を足す。"""
    s = services
    status = sync_status or NoAppSync()

    def subject() -> str:
        return get_access_token().subject  # SDK が検証済みのアクセストークン

    async def synced(subject_: str, view: dict) -> dict:
        """応答に、アプリの最後の同期の時刻を足す（それより後にアプリで記録した分は、まだ見えていない）。"""
        return {**view, "last_app_sync_at": await status.last_app_sync_at(subject_)}

    async def with_today(meal_views: list[dict], subject_: str) -> dict:
        return await synced(subject_, {
            "meals": meal_views,
            "today": views.daily(await s.summaries.daily(subject_, today())),
            "suggested_next": [NEXT_WEEK, NEXT_PROGRESS],
        })


    # --- 記録する ---

    @mcp.tool(annotations=WRITE)
    async def record_meal(meal: MealInput) -> dict:
        """食事を1回分記録する。推定した内容を表で見せ、利用者の了承を得てから呼ぶ。

        kcal と PFC を推定したときは、その根拠（量と、何として計算したか）を basis に一文で入れる（アプリの食事の画面に出る）。
        """
        sub = subject()
        with domain_errors():
            return await with_today([views.meal(await s.meals.record(sub, meal.to_command()))], sub)

    @mcp.tool(annotations=WRITE)
    async def record_meals(meals: list[MealInput]) -> dict:
        """写真をまとめて貼られたときに、複数の食事を一度に記録する。

        先に list_meals で同じ日・同じ区分の記録があるかを確かめ、あれば表に「すでに記録があります」と出す。
        全件を1つの表（日付・区分・料理・kcal・P）で見せ、1回の了承で呼ぶ。1件でも不正なら何も記録しない。
        """
        sub = subject()
        with domain_errors():
            recorded = await s.meals.record_many(sub, [m.to_command() for m in meals])
            return await with_today([views.meal(m) for m in recorded], sub)

    @mcp.tool(annotations=WRITE)
    async def copy_meal(meal_id: str, to: WhenInput) -> dict:
        """記録済みの食事を別の日時に複製する（「昨日と同じ」）。確認なしで呼んでよい。"""
        sub = subject()
        with domain_errors():
            return await with_today([views.meal(await s.meals.copy(sub, meal_id, to.to_eaten_on()))], sub)

    @mcp.tool(annotations=WRITE)
    async def save_template(meal_id: str, name: TemplateName) -> dict:
        """記録済みの食事に名前を付けて「いつもの」として保存する。同じ名前は上書きする。"""
        sub = subject()
        with domain_errors():
            return await synced(sub, views.template(await s.templates.save(sub, meal_id, name)))

    @mcp.tool(annotations=WRITE)
    async def record_template(name: str, when: WhenInput) -> dict:
        """「いつもの」を名前で記録する。確認なしで呼んでよい。"""
        sub = subject()
        with domain_errors():
            return await with_today([views.meal(await s.templates.record(sub, name, when.to_eaten_on()))], sub)

    # --- 読む ---

    @mcp.tool(annotations=READ)
    async def get_meal(meal_id: str) -> dict:
        """食事を1件、品目ごとに返す。品目を直すときは、ここで item_id を調べる。"""
        sub = subject()
        with domain_errors():
            return await synced(sub, views.meal(await s.meals.get(sub, meal_id)))

    @mcp.tool(annotations=READ)
    async def list_meals(start: date, end: date, slot: SlotName | None = None) -> dict:
        """期間（両端を含む、366日まで）の食事を返す。区分で絞れる。"""
        if (end - start).days >= MAX_RANGE_DAYS:
            raise ToolError(f"期間は{MAX_RANGE_DAYS}日までにしてください")
        sub = subject()
        meals = await s.meals.list(sub, start, end, MealSlot(slot) if slot else None)
        return await synced(sub, {"meals": [views.meal(m) for m in meals]})

    @mcp.tool(annotations=READ)
    async def today_status(day: date | None = None) -> dict:
        """その日（省略すると今日）の合計・目標・残り。目標が未設定なら note で知らせる。

        day_type が training なら筋トレの日の目標を使っている（本人が決めた日か、その日に筋トレの記録がある日）。
        """
        sub = subject()
        daily = views.daily(await s.summaries.daily(sub, day or today()))
        return await synced(sub, {**daily, "suggested_next": [NEXT_WEEK, NEXT_PROGRESS]})

    @mcp.tool(annotations=READ)
    async def weekly_review(day: date | None = None) -> dict:
        """day（省略すると今日）を含む週（月曜〜日曜）の食事のふり返り。今週は今日までの日を返す。平均は記録した日だけで出す。

        記録しなかった日や目標との差を責めず、次の一歩を1つだけ提案する。
        previous_next_steps は、前の週のまとめ（save_report の weekly）の次の一歩と、利用者がアプリでチェックしたか（done）。
        なければ null。週のまとめを書くときは、これを先に振り返ってから次の一歩を書く。
        """
        sub = subject()
        start = week_start(day or today())
        end = start + timedelta(days=6)
        if start <= today() < end:  # 今週は今日まで
            end = today()
        weekly = views.weekly(await s.summaries.period(sub, start, end))
        if previous_steps is not None:
            weekly["previous_next_steps"] = await previous_steps.previous_next_steps(sub, start)
        return await synced(sub, {**weekly, "suggested_next": [NEXT_PROGRESS, NEXT_TODAY]})

    @mcp.tool(annotations=READ)
    async def meal_summary(start: date, end: date) -> dict:
        """期間（両端を含む。31日まで）の食事のまとめ：日ごとの kcal・PFC と記録の有無、目標、記録した日の平均と目標との差。

        月のふり返り（start は月の初日、end は月の最後の日か今日）や、前の週（月曜〜日曜）のふり返りに使う。形は weekly_review と同じ。
        記録しなかった日や目標との差を責めない。
        """
        if end < start:
            raise ToolError("end は start と同じか後の日にしてください")
        if (end - start).days >= MAX_SUMMARY_DAYS:
            raise ToolError(f"期間は{MAX_SUMMARY_DAYS}日までにしてください")
        sub = subject()
        return await synced(sub, views.weekly(await s.summaries.period(sub, start, end)))

    # --- 体重とゴールまでの道のり ---

    @mcp.tool(annotations=WRITE)
    async def record_weight(kg: float, day: date | None = None) -> dict:
        """体重を記録する（その日（省略すると今日）の記録があれば上書き）。利用者が言った数字だけを使う。"""
        sub = subject()
        with domain_errors():
            await s.weights.record(sub, day or today(), kg)
        progress = views.progress(await s.weights.progress(sub, today()))
        return await synced(sub, {**progress, "suggested_next": [NEXT_WEEK, NEXT_TODAY]})

    @mcp.tool(annotations=READ)
    async def goal_progress() -> dict:
        """ゴールまでの道のり：直近90日の体重の推移、目標体重まであと何kg、1週間あたりの変化、今のペースでの週数。

        目標体重がなければ、目標を見直して決められること、体重の記録が少なければ record_weight で記録できることを伝える。
        守れていなくても責めない。
        """
        sub = subject()
        progress = views.progress(await s.weights.progress(sub, today()))
        return await synced(sub, {**progress, "suggested_next": [NEXT_WEIGHT, NEXT_WEEK]})

    # --- 直す・消す ---

    @mcp.tool(annotations=WRITE)
    async def update_meal(
        meal_id: str,
        change_amounts: list[AmountChange] | None = None,
        add_items: Annotated[list[ItemInput], Field(max_length=MAX_ITEMS)] | None = None,
        remove_item_ids: list[str] | None = None,
        move_to: WhenInput | None = None,
    ) -> dict:
        """記録済みの食事を直す。量の変更（栄養も同じ割合で変わる）、品目の追加・削除、日時と区分の変更。

        item_id は get_meal か list_meals で調べる。利用者の指示どおりなので、確認なしで呼んでよい。
        """
        sub = subject()
        changes = MealChanges(
            amounts={c.item_id: c.amount for c in change_amounts or []},
            add=tuple(i.to_command() for i in add_items or []),
            remove=tuple(remove_item_ids or []),
            eaten_on=move_to.to_eaten_on() if move_to else None,
        )
        with domain_errors():
            return await with_today([views.meal(await s.meals.update(sub, meal_id, changes))], sub)

    @mcp.tool(annotations=DESTRUCTIVE)
    async def delete_meal(meal_id: str) -> dict:
        """食事を消す。元に戻せないので、どの食事を消すかを利用者に確かめてから呼ぶ。"""
        sub = subject()
        with domain_errors():
            await s.meals.delete(sub, meal_id)
        return await synced(sub, {"deleted": meal_id, "today": views.daily(await s.summaries.daily(sub, today())),
                                  "suggested_next": [NEXT_WEEK]})

    # --- 目標 ---

    @mcp.tool(annotations=READ)
    async def suggest_goals(
        sex: Sex | None = None,
        birth_year: int | None = None,  # 範囲（15〜100歳）はドメインが確かめる（値を文に入れない）
    ) -> dict:
        """目標を決める・変えるときに呼ぶ。体組成の記録とアプリの設定から、筋トレの日・休みの日の目標の案を計算する（保存はしない）。

        アプリ（KARADA）の「自動で計算」と同じ式・同じ数字。一般的な目安で、医療のための計算ではない（利用者にもそう伝える）。
        - 体重・体脂肪率：いちばん新しい体重の日を含む7日の平均（アプリから同期した記録と Health Connect の取り込み）
        - 基礎代謝：体脂肪率があれば Katch-McArdle、なければ Mifflin-St Jeor（性別・生まれた年・身長が要る）
        - 1日の消費：基礎代謝 × 活動の量の係数（設定）。筋トレの日は +280kcal
        - 方針：設定の目標体重との差が ±1% 以内なら維持、減量は週に体重の 0.5%、増量は週に 0.25%（1kg ＝ 7,200kcal）。下限は基礎代謝
        - たんぱく質は体重 × 2.0g、脂質は kcal の 25%、炭水化物は残り
        sex と birth_year は、最初は渡さない。結果の status が needs_input で missing に sex・birth_year があるときだけ、
        本人に聞いて渡す（推測で埋めない）。計算に使うだけで、保存しない。身長・活動の量・体重が足りないときは、
        missing の how のとおりに案内する。status が ok なら、basis（計算のもと）と training_day・rest_day を見せ、
        本人が決めたら（数字を直したいと言われたら直して）set_goals_arguments で set_goals を呼ぶ。
        """
        sub = subject()
        with domain_errors():
            result = await s.goals.suggest(sub, today(), sex, birth_year)
        view = views.auto_goal(result)
        fields = views.auto_goal_fields(result)
        if fields is not None:
            targets = fields.pop("targets")
            view["set_goals_arguments"] = {**fields, **targets}  # このまま set_goals に渡せる形
        return await synced(sub, view)  # 記録はアプリから同期した分なので、最後の同期の時刻も返す

    @mcp.tool(annotations=WRITE)
    async def set_goals(
        policy: Policy,
        body_weight_kg: BodyWeightKg | None = None,
        protein_per_kg: ProteinPerKg | None = None,
        training_day: DailyTargetInput | None = None,
        rest_day: DailyTargetInput | None = None,
        eating_style: EatingStyle | None = None,
        target_weight_kg: float | None = None,  # 30〜300kg はドメインが確かめる（同期と同じ範囲）
    ) -> dict:
        """目標を保存する（食べた人ごとに1つ。上書きする）。必須なのは方針だけ。

        値は suggest_goals の案（set_goals_arguments）か、利用者が言った数字だけを使う。推測で決めない。
        suggest_goals の案は、本人に見せて決めてもらってから保存する（勝手に保存しない）。
        kcal などを利用者が直接決めたときは、training_day と rest_day に同じ値を入れてよい。
        """
        sub = subject()
        with domain_errors():
            goal = NutritionGoal(
                EaterId(sub),  # サービスがトークンの本人に置き換える
                policy,
                body_weight_kg,
                protein_per_kg,
                DailyTarget(training_day.kcal, training_day.fat_g, training_day.carbs_g) if training_day else None,
                DailyTarget(rest_day.kcal, rest_day.fat_g, rest_day.carbs_g) if rest_day else None,
                eating_style,
                target_weight_kg,
            )
            return await synced(sub, views.goal(await s.goals.set_goals(sub, goal)))

    @mcp.tool(annotations=WRITE)
    async def set_day_type(day_type: DayType, day: date | None = None) -> dict:
        """その日（省略すると今日）を筋トレの日（training）か休みの日（rest）にする。

        決めていない日は、その日に筋トレの記録があれば筋トレの日、なければ休みの日として扱う。
        ここで決めた日は、筋トレの記録の有無より優先する。筋トレを記録していないのに「今日は筋トレした」と言われたときや、
        記録はあるが休みの日の目標にしたいと言われたときに呼ぶ。こちらから聞きはしない。
        """
        sub = subject()
        await s.goals.set_day_type(sub, day or today(), day_type)
        return await synced(sub, views.daily(await s.summaries.daily(sub, day or today())))


@contextmanager
def domain_errors():
    """ドメインの決まりに反したときは、理由を Claude に見せる（Claude が言い直せるように）。"""
    try:
        yield
    except MealError as e:
        raise ToolError(str(e)) from e
