"""MCP の入口（筋トレのツール）。ツールの説明文は Claude（ChatGPT）への指示を兼ねる。

ここはツールを登録するだけで、サーバー（MCPServer）と認証は作らない。食事と筋トレのツールを1つのサーバーに
まとめるのは、組み立ての場所（services/mcp/main.py）。
筋トレの scope（training:read・training:write）は、ツールごとに確かめる。接続（HTTP）のところで必須にすると、
筋トレの scope を持たない今のコネクタ（同意し直す前）が、食事のツールまで使えなくなるため。
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, timedelta
from typing import Annotated, Callable, Literal, Protocol

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

from training.application.commands import (
    InjuryChanges,
    NewExerciseSets,
    NewInjury,
    NewSet,
    SetChange,
    TrainingCommands,
    WorkoutChanges,
)
from training.application.queries import TrainingQueries
from training.domain.errors import TrainingError
from training.domain.injury import (
    MAX_CAUSE,
    MAX_FIX,
    MAX_LIST_INJURIES,
    MAX_PHASE,
    MAX_REVIEW_NOTE,
    MAX_SYMPTOM,
    SITES,
    ReviewResult,
    Side,
    SiteCode,
)
from training.domain.model import RecordType
from training.presentation import views

READ_SCOPE, WRITE_SCOPE = "training:read", "training:write"
MAX_RANGE_DAYS = 366
MAX_HEALTH_DAYS = 90  # 睡眠・心拍・歩数のまとめで一度に読める日数
PERIOD_START = "期間の初日（YYYY-MM-DD）。前の日・週・月のまとめを書くときに渡す。省くと end の days−1 日前"
PERIOD_END = "期間の最後の日（YYYY-MM-DD。両端を含む）。省くと今日"

INSTRUCTIONS = """筋トレ（hlog）：種目・セットごとの重量と回数を記録し、総負荷量・推定1RM・自己ベスト・週のふり返り・体組成の推移を返す。
記録は、利用者が言った種目・重量・回数をそのまま record_workout に渡す（確認なしでよい）。数字を推測で埋めない。
種目は名前の完全一致でだけ選ぶ。「ベンチ」のように略した名前で見つからないときは、返ってきた候補から利用者の意図がはっきりしていればその名前で呼び直し、迷うなら利用者に聞く。
総負荷量（重量×回数の合計。回数だけの自重の種目は、体重×種目の割合×回数）・推定1RM（Epley 式。自重の種目は出さない）・自己ベストはサーバーが計算する。AI が計算し直さない。
推移（総負荷量、推定1RM、体重）は、描けるならグラフで見せる。部位の偏りは割合で見せる。記録の少なさや休んだ日を責めない。
睡眠・心拍・歩数は、アプリが Health Connect（ウォッチなど）から取り込んだもの（sleep_summary、heart_rate_summary、step_summary。読むだけ）。病気の診断はしない。
ケガの記録：筋トレで痛めたと言われたら record_injury で、日付・部位・左右・種目・場面・症状と、利用者が言った原因と直し方をそのまま記録する。
言っていない原因や直し方を推測で埋めない（空のまま記録し、あとで update_injury で足せる）。痛みの強さや体調は聞かない。診断や治療の助言はしない。
記録したら「次にその種目を記録するとき、アプリに直すことが出る」と伝える。その後の様子は add_injury_review、直せたら mark_injury_fixed。
フェーズ（増量・減量・維持と療養の期間）は、本人がアプリで始める・変える（自動では始まらない）。ここでは list_phases で読むだけで、作る・変えるツールはない。始めたい・変えたいと言われたら、アプリのフェーズの画面で宣言するよう伝える。"""

RATIO_DESCRIPTION = ("回数だけ（reps_only）の種目の、体重に対する割合（0〜1）。自重の負荷量 ＝ 体重×割合×回数。"
                     "目安：懸垂・チンニング 1、ディップス 0.95、自重スクワット 0.7、腕立て伏せ 0.65、膝つき腕立て 0.5、"
                     "腹筋（クランチなど）0.3、プランクなど時間で行う種目は 0（総負荷量に入れない）。利用者が言わなければ省く")

SITE_DESCRIPTION = "部位のコード（左右は side で分ける）：" + "、".join(
    f"{code}＝{site.name}{'' if site.sided else '（左右なし）'}" for code, site in SITES.items()) + (
    "。脊柱起立筋（背骨のすぐ横の縦の筋肉）は、背中上部（胸の高さ）なら upper_back、腰なら lower_back。"
    "僧帽筋（trapezius）・広背筋（lats）とは別")
SIDE_DESCRIPTION = "左右（left・right）。左右のない部位と、利用者が左右を言っていないときは省く"
OWN_WORDS = "利用者の言葉のまま。言っていなければ省く（推測で埋めない）"

READ = ToolAnnotations(read_only_hint=True)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False)
DESTRUCTIVE = ToolAnnotations(read_only_hint=False, destructive_hint=True)


class AppSyncStatus(Protocol):
    """アプリの最後の同期の時刻（同期の仕組みが持つ）。組み立ての場所でつなぐ。"""

    async def last_app_sync_at(self, subject: str) -> str | None: ...


class NoAppSync:
    async def last_app_sync_at(self, subject: str) -> str | None:
        return None


# --- 入力の型。SDK がここから JSON Schema を作り、AI に見せる ---


class SetInput(BaseModel):
    weight_kg: float | None = Field(
        None, gt=0, le=500, description="重量（kg）。lb で言われたら kg に直す。回数だけの種目（懸垂・腕立て伏せなど）は省く")
    reps: int = Field(ge=1, le=10000, description="回数")
    memo: str = Field("", max_length=1000, description="メモ（フォーム、補助ありなど）。なければ省く")


class ExerciseInput(BaseModel):
    exercise: str = Field(description="種目の名前（list_exercises の名前と同じもの）か exercise_id")
    sets: list[SetInput] = Field(min_length=1, max_length=50, description="セット。行った順")


class SetChangeInput(BaseModel):
    set_id: str = Field(description="get_workout で調べた set_id")
    weight_kg: float | None = Field(None, gt=0, le=500, description="新しい重量（kg）。変えないなら省く")
    reps: int | None = Field(None, ge=1, le=10000, description="新しい回数。変えないなら省く")
    memo: str | None = Field(None, max_length=1000, description="新しいメモ。変えないなら省く。消すなら空の文字")


def register_training_tools(
    mcp: MCPServer,
    commands: TrainingCommands,
    queries: TrainingQueries,
    today: Callable[[], date],
    sync_status: AppSyncStatus | None = None,
) -> None:
    """筋トレのツールを mcp に登録する。"""
    status = sync_status or NoAppSync()

    def subject(scope: str) -> str:
        """検証済みのアクセストークンに scope があれば本人（sub）を返す。なければ断る。"""
        token = get_access_token()
        if token is None or scope not in token.scopes:
            what = "読む" if scope == READ_SCOPE else "書く"
            raise ToolError(
                f"筋トレの記録を{what}許可（{scope}）がありません。筋トレのツールを足す前につないだコネクタです。"
                "利用者に、コネクタの連携をいったん解除してつなぎ直し、同意画面で許可するよう伝えてください。"
                "食事のツールは今のまま使えます。")
        return token.subject

    async def synced(sub: str, view: dict) -> dict:
        """応答に、アプリの最後の同期の時刻を足す（それより後にアプリで記録した分は、まだ見えていない）。"""
        return {**view, "last_app_sync_at": await status.last_app_sync_at(sub)}

    def day_of(day: date | None) -> str:
        return (day or today()).isoformat()

    def check_range(start: date, end: date, max_days: int = MAX_RANGE_DAYS) -> None:
        if end < start:
            raise ToolError("end は start と同じか後の日にしてください")
        if (end - start).days >= max_days:
            raise ToolError(f"期間は{max_days}日までにしてください")

    def period(days: int, start: date | None, end: date | None, max_days: int) -> tuple[date, date]:
        """まとめの期間。省くと end は今日、start は end の days−1 日前（exercise_history と同じ決め方）。"""
        end = end or today()
        start = start or end - timedelta(days=days - 1)
        check_range(start, end, max_days)
        return start, end

    async def workout_view(sub: str, day: str) -> dict:
        workout = await queries.workout(sub, day)
        catalog = await queries.catalog(sub)
        return views.workout(workout, catalog, await queries.personal_bests_before(sub, day),
                             await queries.body_weights(sub))

    # --- 記録する ---

    @mcp.tool(annotations=WRITE)
    async def record_workout(exercises: list[ExerciseInput], day: date | None = None) -> dict:
        """筋トレを記録する。その日（省略すると今日）に、種目とセット（重量・回数・メモ）を足す。

        利用者が言った数字をそのまま使い、確認なしで呼んでよい。同じ日に同じ種目がすでにあれば、そのセットの後ろに足す。
        同じ内容を2回記録しないよう、続けて言われたときなど迷ったら、先に get_workout でその日の記録を確かめる。
        種目の名前が見つからないときは理由と候補が返るので、それに従って呼び直す（新しい種目なら add_exercise）。
        返ってきた総負荷量と、自己ベストを超えた種目（new_personal_best）を一言で伝える。
        """
        sub = subject(WRITE_SCOPE)
        items = [NewExerciseSets(e.exercise, tuple(NewSet(s.weight_kg, s.reps, s.memo) for s in e.sets))
                 for e in exercises]
        with training_errors():
            await commands.record_workout(sub, day_of(day), items)
        return await synced(sub, await workout_view(sub, day_of(day)))

    # --- 読む ---

    @mcp.tool(annotations=READ)
    async def get_workout(day: date | None = None) -> dict:
        """その日（省略すると今日）の筋トレを、種目・セットごとに返す。総負荷量、推定1RM、自己ベストを超えたかも付ける。

        回数だけの自重の種目の負荷量は、その日の体重（なければ30日以内のいちばん近い前の日）×種目の割合（bodyweight_ratio）×回数。
        使った体重は bodyweight_kg。体重の記録がなければ自重の種目は総負荷量に入らず、note で知らせる（利用者に伝える）。

        記録を直す・消すときは、ここで entry_id（種目）と set_id（セット）を調べる。
        """
        sub = subject(READ_SCOPE)
        return await synced(sub, await workout_view(sub, day_of(day)))

    @mcp.tool(annotations=READ)
    async def list_workouts(start: date, end: date) -> dict:
        """期間（両端を含む。366日まで）に筋トレをした日と、日ごとの種目・セット数・総負荷量を返す。

        総負荷量には、回数だけの自重の種目も入る（その日の体重×種目の割合×回数）。体重の記録がない日は入らず、note で知らせる。
        """
        sub = subject(READ_SCOPE)
        check_range(start, end)
        workouts = await queries.workouts(sub, start.isoformat(), end.isoformat())
        catalog = await queries.catalog(sub)
        weights = await queries.body_weights(sub)
        return await synced(sub, {"workouts": [views.workout_summary(w, catalog, weights) for w in workouts]})

    @mcp.tool(annotations=READ)
    async def exercise_history(exercise: str, start: date | None = None, end: date | None = None) -> dict:
        """種目ごとの推移：日ごとの総負荷量と推定1RM の最大、自己ベスト（これまでで推定1RM が最大のセット）。

        exercise は種目の名前か exercise_id。期間を省くと、end は今日、start は end の179日前（約半年）。
        推移はグラフで見せる。
        """
        sub = subject(READ_SCOPE)
        end = end or today()
        start = start or end - timedelta(days=179)
        check_range(start, end)
        catalog = await queries.catalog(sub)
        with training_errors():
            found = catalog.find_exercise(exercise)
        history = await queries.exercise_history(sub, found.id)
        return await synced(sub, views.history(history, found, catalog, start.isoformat(), end.isoformat()))

    @mcp.tool(annotations=READ)
    async def weekly_training_review(day: date | None = None) -> dict:
        """その日（省略すると今日）を含む週（月曜〜日曜、アプリと同じ）の筋トレのふり返り。

        回数（sessions）、総負荷量、部位ごとの総負荷量と割合（偏り）、この週にまだ鍛えていない部位、先週との比べ、
        前回の筋トレからの日数、直近8週の総負荷量の推移を返す。偏りや休みを責めず、次の一歩を1つだけ提案する。
        総負荷量には、回数だけの自重の種目も入る（その日の体重×種目の割合×回数。アプリのホームの合計と同じ）。
        体重の記録がなくて入らなかったセットがあれば note で知らせる。
        """
        sub = subject(READ_SCOPE)
        review = await queries.weekly_review(sub, day_of(day))
        return await synced(sub, views.weekly(review, await queries.catalog(sub)))

    @mcp.tool(annotations=READ)
    async def list_exercises(include_hidden: bool = False) -> dict:
        """部位と種目の一覧（アプリと同じもの）。記録の前に種目の正しい名前を確かめるときに呼ぶ。

        隠した種目は、include_hidden を true にすると出る（隠した種目も記録には使える）。
        BIG3 に割り当てた種目には big3（bench・squat・deadlift）、フォームの動画のリンクがある種目には form_video_url が付く。
        どちらもアプリの種目の編集で決める（ここからは変えられない）。
        名前・部位を変える、隠す・表示に戻すときは update_exercise。
        """
        sub = subject(READ_SCOPE)
        return await synced(sub, views.catalog_view(await queries.catalog(sub), include_hidden))

    # --- 直す・消す ---

    @mcp.tool(annotations=WRITE)
    async def update_workout(
        day: date,
        change_sets: list[SetChangeInput] | None = None,
        remove_set_ids: list[str] | None = None,
        remove_entry_ids: list[str] | None = None,
        move_to: date | None = None,
    ) -> dict:
        """その日の筋トレの記録を直す：セットの重量・回数・メモを変える、セットを消す、種目ごと消す、
        その日の記録をまるごと別の日（move_to）に移す。セットや種目を足すときは record_workout を使う。

        entry_id と set_id は get_workout で調べる。利用者の指示どおりなので、確認なしで呼んでよい。
        種目の最後のセットは消せない（種目ごと消すときは remove_entry_ids）。
        """
        sub = subject(WRITE_SCOPE)
        changes = WorkoutChanges(
            sets=tuple(SetChange(c.set_id, c.weight_kg, c.reps, c.memo) for c in change_sets or []),
            remove_set_ids=tuple(remove_set_ids or []),
            remove_entry_ids=tuple(remove_entry_ids or []),
            move_to=move_to.isoformat() if move_to else None,
        )
        with training_errors():
            workout = await commands.update_workout(sub, day.isoformat(), changes)
        return await synced(sub, await workout_view(sub, workout.date))

    @mcp.tool(annotations=DESTRUCTIVE)
    async def delete_workout(day: date, entry_ids: list[str] | None = None) -> dict:
        """その日の筋トレの記録を消す。entry_ids を渡すとその種目だけ、省くとその日の全部を消す。

        アプリからも消える。どの日の、どの種目を消すかを利用者に確かめてから呼ぶ。
        """
        sub = subject(WRITE_SCOPE)
        with training_errors():
            deleted = await commands.delete_workout(sub, day.isoformat(), entry_ids)
        return await synced(sub, {"deleted_entry_ids": deleted, "remaining": await workout_view(sub, day.isoformat())})

    @mcp.tool(annotations=WRITE)
    async def add_exercise(
        name: str, body_part: str, record_type: Literal["weight_reps", "reps_only"] = "weight_reps",
        bodyweight_ratio: Annotated[float | None, Field(ge=0, le=1, description=RATIO_DESCRIPTION)] = None,
    ) -> dict:
        """種目を足す（アプリにも出る）。list_exercises にない種目を記録したいときに、利用者に名前と部位を確かめてから呼ぶ。

        body_part は部位の名前（胸・背中・肩・脚など、list_exercises の部位）。record_type は、重量×回数の種目なら
        weight_reps、自重で回数だけの種目なら reps_only。同じ部位に同じ名前の種目は作れない。
        reps_only の種目は、総負荷量に体重×bodyweight_ratio×回数で入る。省くと名前から決める（返り値の bodyweight_ratio）。
        """
        sub = subject(WRITE_SCOPE)
        with training_errors():
            exercise = await commands.add_exercise(sub, name, body_part, RecordType(record_type), bodyweight_ratio)
        return await synced(sub, views.exercise(exercise, await queries.catalog(sub)))

    @mcp.tool(annotations=WRITE)
    async def update_exercise(
        exercise: str,
        name: str | None = None,
        body_part: str | None = None,
        hidden: bool | None = None,
        bodyweight_ratio: Annotated[float | None, Field(ge=0, le=1, description=RATIO_DESCRIPTION)] = None,
    ) -> dict:
        """種目の名前・部位・体重に対する割合（回数だけの種目）を変える、隠す（hidden=true）・表示に戻す（hidden=false）。
        変えない項目は省く（アプリにも反映される）。割合を変えると、過去の記録の総負荷量も新しい割合で出る。

        exercise は今の名前か exercise_id（隠した種目は list_exercises の include_hidden で調べる）。body_part は部位の名前。
        記録は種目の ID でつながっているので、過去の記録もそのまま新しい名前で出る。同じ部位に同じ名前の種目は作れない。
        種目を消すツールはない。使わなくなった種目は、消す代わりに hidden=true で隠す（過去の記録は残り、記録にも使える）。
        利用者の指示どおりなので、確認なしで呼んでよい。
        """
        sub = subject(WRITE_SCOPE)
        with training_errors():
            updated = await commands.update_exercise(sub, exercise, name, body_part, hidden, bodyweight_ratio)
        return await synced(sub, views.exercise(updated, await queries.catalog(sub)))

    # --- 体組成 ---

    @mcp.tool(annotations=WRITE)
    async def record_body(
        day: date | None = None,
        weight_kg: float | None = None,
        body_fat_pct: float | None = None,
        memo: str | None = None,
    ) -> dict:
        """体組成（体重・体脂肪率）を、その日（省略すると今日）の手入力の記録として残す（アプリの体組成と同じ）。

        利用者が言った数字だけを渡す。その日の手入力の記録があれば、渡した項目だけを書き換える。
        食事の目標体重までの進み具合（goal_progress）は、今は別の記録（record_weight）から出す。
        体重だけを言われ、どちらに記録するか分からなければ、利用者に聞く。
        """
        sub = subject(WRITE_SCOPE)
        values = {"weight_kg": weight_kg, "body_fat_pct": body_fat_pct}
        with training_errors():
            await commands.record_body(sub, day_of(day), values, memo)
        end = today().isoformat()
        start = (today() - timedelta(days=27)).isoformat()
        progress = await queries.body_progress(sub, start, end)
        recorded = next((d for d in progress.days if d.date == day_of(day)), None)
        if recorded is None:  # 28日より前の日
            recorded = next(d for d in await queries.daily_body(sub) if d.date == day_of(day))
        return await synced(sub, {"recorded": views.daily_body(recorded),
                                  "progress": views.body_progress(progress, start, end)})

    @mcp.tool(annotations=READ)
    async def body_progress(
        days: Annotated[int, Field(ge=7, le=366, description="end までの何日分か（start を渡したときは使わない）")] = 90,
        start: Annotated[date | None, Field(description=PERIOD_START)] = None,
        end: Annotated[date | None, Field(description=PERIOD_END)] = None,
    ) -> dict:
        """体組成の推移：日ごとの体重・体脂肪率と、体脂肪量・除脂肪量、end までの28日の体重の週あたりの変化。

        期間は start〜end（両端を含む。366日まで）。省くと end は今日、start は end の days−1 日前。
        前の日・前の週のまとめを書くときは、その期間を start と end で渡す。
        1日の値は、項目ごとに手入力（アプリ・record_body）を先にし、手入力がなければ Health Connect の取り込み（体重計など）を使う。
        推移はグラフで見せる。増減を責めない。
        """
        sub = subject(READ_SCOPE)
        start, end = period(days, start, end, MAX_RANGE_DAYS)
        progress = await queries.body_progress(sub, start.isoformat(), end.isoformat())
        return await synced(sub, views.body_progress(progress, start.isoformat(), end.isoformat()))

    # --- 睡眠・心拍・歩数（アプリが Health Connect から取り込んだもの。読むだけ） ---

    @mcp.tool(annotations=READ)
    async def sleep_summary(
        days: Annotated[int, Field(ge=7, le=MAX_HEALTH_DAYS, description="end までの何日分か（start を渡したときは使わない）")] = 7,
        start: Annotated[date | None, Field(description=PERIOD_START)] = None,
        end: Annotated[date | None, Field(description=PERIOD_END)] = None,
    ) -> dict:
        """睡眠のまとめ：起きた日ごとの眠っていた時間（分）・起きていた時間・寝た時刻と起きた時刻（日本時間）と、期間の平均。

        期間は start〜end（両端を含む。90日まで。日は起きた日）。省くと end は今日、start は end の days−1 日前。

        アプリ（hlog）が Health Connect（ウォッチなど）から取り込んだもの。記録がない日は含めない。
        1日に複数の睡眠（昼寝など）があれば足し、寝た時刻・起きた時刻はいちばん長い睡眠のもの。
        推移は描けるならグラフで見せる。睡眠の短さを責めない。病気の診断はしない。
        """
        sub = subject(READ_SCOPE)
        start, end = period(days, start, end, MAX_HEALTH_DAYS)
        summary = await queries.sleep_summary(sub, start.isoformat(), end.isoformat())
        return await synced(sub, views.sleep_summary(summary, start.isoformat(), end.isoformat()))

    @mcp.tool(annotations=READ)
    async def heart_rate_summary(
        days: Annotated[int, Field(ge=7, le=MAX_HEALTH_DAYS, description="end までの何日分か（start を渡したときは使わない）")] = 7,
        start: Annotated[date | None, Field(description=PERIOD_START)] = None,
        end: Annotated[date | None, Field(description=PERIOD_END)] = None,
    ) -> dict:
        """心拍のまとめ：日ごとの安静時心拍・平均・最低・最高（拍/分）と測った回数、期間の安静時心拍の平均。

        期間は start〜end（両端を含む。90日まで）。省くと end は今日、start は end の days−1 日前。

        アプリ（hlog）が Health Connect（ウォッチなど）から取り込んだ1日のまとめ（1回ごとの値は持たない）。記録がない日は含めない。
        安静時心拍の推移は、トレーニングの疲れや回復の目安として、描けるならグラフで見せる。病気の診断はしない。
        """
        sub = subject(READ_SCOPE)
        start, end = period(days, start, end, MAX_HEALTH_DAYS)
        summary = await queries.heart_rate_summary(sub, start.isoformat(), end.isoformat())
        return await synced(sub, views.heart_rate_summary(summary, start.isoformat(), end.isoformat()))

    @mcp.tool(annotations=READ)
    async def step_summary(
        days: Annotated[int, Field(ge=7, le=MAX_HEALTH_DAYS, description="end までの何日分か（start を渡したときは使わない）")] = 7,
        start: Annotated[date | None, Field(description=PERIOD_START)] = None,
        end: Annotated[date | None, Field(description=PERIOD_END)] = None,
    ) -> dict:
        """歩数のまとめ：日ごとの歩数の合計と、期間の平均（記録がある日の平均。整数に丸める）。

        期間は start〜end（両端を含む。90日まで）。省くと end は今日、start は end の days−1 日前。

        アプリ（hlog）が Health Connect（スマホ・ウォッチなど）から取り込んだ1日の合計（1件ごとの記録は持たない）。
        記録がない日は含めない（0歩の日とは限らない）。推移は描けるならグラフで見せる。歩数の少なさを責めない。
        """
        sub = subject(READ_SCOPE)
        start, end = period(days, start, end, MAX_HEALTH_DAYS)
        summary = await queries.step_summary(sub, start.isoformat(), end.isoformat())
        return await synced(sub, views.step_summary(summary, start.isoformat(), end.isoformat()))

    # --- ケガの記録 ---

    async def injury_view(sub: str, injury_id: str) -> dict:
        record = next(r for r in await queries.injuries(sub) if r.injury.id == injury_id)
        return views.injury(record.injury, record.reviews, await queries.catalog(sub))

    @mcp.tool(annotations=WRITE)
    async def record_injury(
        site: Annotated[SiteCode, Field(description=SITE_DESCRIPTION)],
        side: Annotated[Side | None, Field(description=SIDE_DESCRIPTION)] = None,
        day: Annotated[date | None, Field(description="痛めた日。省くと今日")] = None,
        exercise: Annotated[str | None, Field(
            description="そのときの種目の名前（list_exercises の名前と同じもの）か exercise_id。なければ省く")] = None,
        phase: Annotated[str, Field(max_length=MAX_PHASE, description="場面（例：3セット目の下ろすとき）")] = "",
        symptom: Annotated[str, Field(max_length=MAX_SYMPTOM, description="何が起きたか（例：肩の前がピリッとした）")] = "",
        cause: Annotated[str, Field(max_length=MAX_CAUSE, description="原因の自己分析。" + OWN_WORDS)] = "",
        fix: Annotated[str, Field(max_length=MAX_FIX, description="次の直し方。" + OWN_WORDS)] = "",
    ) -> dict:
        """筋トレで痛めたことを記録する（直している途中として）。アプリのケガの記録にも出る。

        原因（cause）と直し方（fix）は、利用者が言ったことをそのまま渡す。言っていなければ省き、推測で埋めない。
        痛みの強さや体調は聞かない。診断や治療の助言はしない。
        種目の名前が見つからないときは理由と候補が返るので、それに従って呼び直す。
        記録したら「次にその種目を記録するとき、アプリに直すことが出る」と伝える。
        """
        sub = subject(WRITE_SCOPE)
        with training_errors():
            injury = await commands.record_injury(sub, NewInjury(
                day_of(day), site, side, exercise, phase, symptom, cause, fix))
        return await synced(sub, {"recorded": await injury_view(sub, injury.id)})

    @mcp.tool(annotations=READ)
    async def list_injuries(
        status: Annotated[Literal["fixing", "fixed"] | None, Field(
            description="fixing（直している途中）か fixed（直せた）で絞る。省くと全部")] = None,
        limit: Annotated[int, Field(ge=1, le=MAX_LIST_INJURIES, description="返す数（新しい順）")] = 20,
    ) -> dict:
        """ケガの記録の一覧（新しい順）。振り返り（reviews。新しい20件を古い順に。全部の数は review_count）も付ける。

        直す・振り返りを足す・消すときは、ここで injury_id を調べる。total は絞ったあとの全部の数。
        """
        sub = subject(READ_SCOPE)
        records = await queries.injuries(sub, status)
        return await synced(sub, views.injury_list(records, await queries.catalog(sub), limit))

    @mcp.tool(annotations=READ)
    async def list_phases(
        limit: Annotated[int, Field(ge=1, le=50, description="返す数（開始日の新しい順）")] = 10,
    ) -> dict:
        """フェーズ（増量 bulk・減量 cut・維持 maintain の通常のフェーズと、療養 rehab）の一覧と、今のフェーズ。読むだけ。

        current は今のフェーズ（療養中なら療養）、paused は療養で止まっている通常のフェーズ（なければ null）。
        各フェーズに、今日の時点の何週目（week。止まった日は数えない）・全体の週数・実際の終わり（effective_end_date。
        療養の日数だけ後ろにずれる）・残りの日数・目標体重・予定の体重（plan_weight_kg）・ペース（pace）を付ける。
        pace.status は on_track（順調。直近7日の体重の平均と予定の差が ±0.3kg 以内）・fast（早い）・slow（遅い）、
        維持は over・under。判定しないときは status が null で、not_judged_reason（not_active・paused 療養中・
        recovering 療養から戻って14日・few_weigh_ins 7日に測った日が1日以下・no_plan）。
        通常のフェーズには、振り返りの材料（review_material）も付ける：period_start〜period_end（開始日〜続いた最後の日。実施中は今日まで、
        finished が false）、rehab_spans（療養で止まった期間。振り返りの対象から除く）、start（開始時の記録：体重・体脂肪率・
        BIG3・成長スコア）と end（period_end の時点の、同じ出し方の値：体重と体脂肪率は7日の平均、BIG3 はその日までの最高の
        推定1RM。成長スコアはアプリが出すので null）、big3_compared（両方に値がある役だけの合計）。目標の変更の履歴は target_history、
        療養の日数は rehab_days。フェーズの振り返り（save_report の kind が phase）はこれを材料に書く。
        フェーズを始める・変えるのは本人がアプリでする（このサーバーには書くツールがない）。
        """
        sub = subject(READ_SCOPE)
        today = day_of(None)
        listed, current, paused = await queries.phase_progresses(sub, today, limit=limit)
        reviews = await queries.phase_reviews(sub, [pp for pp in (*listed, current, paused) if pp is not None], today)

        def detail(pp):
            return views.phase_detail(pp, reviews.get(pp.phase.id))

        return await synced(sub, {
            "current": detail(current) if current else None,
            "paused": detail(paused) if paused else None,
            "phases": [detail(pp) for pp in listed],
            "total": len(await queries.phases(sub)),
        })

    @mcp.tool(annotations=WRITE)
    async def add_injury_review(
        injury_id: str,
        result: Annotated[ReviewResult, Field(description="fixed（直せた）・not_yet（まだ）・pain（痛んだ）")],
        day: Annotated[date | None, Field(description="試した日。省くと今日")] = None,
        note: Annotated[str, Field(max_length=MAX_REVIEW_NOTE,
                                   description="メモ（試したこと、気づいたこと）。利用者の言葉のまま。なければ省く")] = "",
        exercise: Annotated[str | None, Field(description="試した種目の名前か exercise_id。なければ省く")] = None,
    ) -> dict:
        """ケガのその後を振り返る（直し方を試した結果）。injury_id は list_injuries で調べる。

        結果が fixed（直せた）でも、ケガの状態は変わらない。利用者がもう直せたと言うなら mark_injury_fixed も呼ぶ。
        """
        sub = subject(WRITE_SCOPE)
        with training_errors():
            await commands.add_injury_review(sub, injury_id, day_of(day), result, note, exercise)
        return await synced(sub, {"injury": await injury_view(sub, injury_id)})

    @mcp.tool(annotations=WRITE)
    async def mark_injury_fixed(
        injury_id: str,
        day: Annotated[date | None, Field(description="直せた日。省くと今日")] = None,
    ) -> dict:
        """ケガを直せたにする（直せた日を入れる）。直している途中に戻すときは update_injury の reopen。"""
        sub = subject(WRITE_SCOPE)
        with training_errors():
            await commands.mark_injury_fixed(sub, injury_id, day_of(day))
        return await synced(sub, {"injury": await injury_view(sub, injury_id)})

    @mcp.tool(annotations=WRITE)
    async def update_injury(
        injury_id: str,
        day: Annotated[date | None, Field(description="痛めた日を変える。変えないなら省く")] = None,
        site: Annotated[SiteCode | None, Field(description="部位を変える。変えないなら省く。" + SITE_DESCRIPTION)] = None,
        side: Annotated[Side | None, Field(
            description="左右を変える。変えないなら省く（左右のない部位に変えると左右は外れる）")] = None,
        exercise: Annotated[str | None, Field(
            description="種目を変える（名前か exercise_id）。空の文字で外す。変えないなら省く")] = None,
        phase: Annotated[str | None, Field(max_length=MAX_PHASE, description="場面。変えないなら省く")] = None,
        symptom: Annotated[str | None, Field(max_length=MAX_SYMPTOM, description="症状。変えないなら省く")] = None,
        cause: Annotated[str | None, Field(
            max_length=MAX_CAUSE, description="原因の自己分析（利用者の言葉のまま）。変えないなら省く")] = None,
        fix: Annotated[str | None, Field(
            max_length=MAX_FIX, description="次の直し方（利用者の言葉のまま）。変えないなら省く")] = None,
        reopen: Annotated[bool, Field(description="true で直している途中に戻す（直せた日を消す）")] = False,
    ) -> dict:
        """ケガの記録を書き直す（原因や直し方の書き直し・書き足し、直している途中に戻すなど）。渡した項目だけを変える。

        文字の項目は、空の文字にすると消える。原因と直し方は、利用者が言ったことをそのまま渡す（推測で書き足さない）。
        """
        sub = subject(WRITE_SCOPE)
        changes = InjuryChanges(day.isoformat() if day else None, site, side, exercise, phase, symptom, cause, fix,
                                reopen)
        with training_errors():
            await commands.update_injury(sub, injury_id, changes)
        return await synced(sub, {"injury": await injury_view(sub, injury_id)})

    @mcp.tool(annotations=DESTRUCTIVE)
    async def delete_injury(injury_id: str) -> dict:
        """ケガの記録を消す。振り返りも一緒に消える（アプリからも消える）。どの記録を消すかを利用者に確かめてから呼ぶ。"""
        sub = subject(WRITE_SCOPE)
        with training_errors():
            reviews = await commands.delete_injury(sub, injury_id)
        return await synced(sub, {"deleted_injury_id": injury_id, "deleted_review_count": reviews})

@contextmanager
def training_errors():
    """ドメインの決まりに反したときは、理由を AI に見せる（AI が言い直せるように）。"""
    try:
        yield
    except TrainingError as e:
        raise ToolError(str(e)) from e
