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

from training.application.commands import NewExerciseSets, NewSet, SetChange, TrainingCommands, WorkoutChanges
from training.application.queries import TrainingQueries
from training.domain.errors import TrainingError
from training.domain.model import RecordType
from training.presentation import views

READ_SCOPE, WRITE_SCOPE = "training:read", "training:write"
MAX_RANGE_DAYS = 366

INSTRUCTIONS = """筋トレ（hlog）：種目・セットごとの重量と回数を記録し、総負荷量・推定1RM・自己ベスト・週のふり返り・体組成の推移を返す。
記録は、利用者が言った種目・重量・回数をそのまま record_workout に渡す（確認なしでよい）。数字を推測で埋めない。
種目は名前の完全一致でだけ選ぶ。「ベンチ」のように略した名前で見つからないときは、返ってきた候補から利用者の意図がはっきりしていればその名前で呼び直し、迷うなら利用者に聞く。
総負荷量（重量×回数の合計）・推定1RM（Epley 式）・自己ベストはサーバーが計算する。AI が計算し直さない。
推移（総負荷量、推定1RM、体重）は、描けるならグラフで見せる。部位の偏りは割合で見せる。記録の少なさや休んだ日を責めない。
睡眠と心拍は、アプリが Health Connect（ウォッチなど）から取り込んだもの（sleep_summary、heart_rate_summary。読むだけ）。病気の診断はしない。"""

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

    def check_range(start: date, end: date) -> None:
        if end < start:
            raise ToolError("end は start と同じか後の日にしてください")
        if (end - start).days >= MAX_RANGE_DAYS:
            raise ToolError(f"期間は{MAX_RANGE_DAYS}日までにしてください")

    async def workout_view(sub: str, day: str) -> dict:
        workout = await queries.workout(sub, day)
        catalog = await queries.catalog(sub)
        return views.workout(workout, catalog, await queries.personal_bests_before(sub, day))

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

        記録を直す・消すときは、ここで entry_id（種目）と set_id（セット）を調べる。
        """
        sub = subject(READ_SCOPE)
        return await synced(sub, await workout_view(sub, day_of(day)))

    @mcp.tool(annotations=READ)
    async def list_workouts(start: date, end: date) -> dict:
        """期間（両端を含む。366日まで）に筋トレをした日と、日ごとの種目・セット数・総負荷量を返す。"""
        sub = subject(READ_SCOPE)
        check_range(start, end)
        workouts = await queries.workouts(sub, start.isoformat(), end.isoformat())
        catalog = await queries.catalog(sub)
        return await synced(sub, {"workouts": [views.workout_summary(w, catalog) for w in workouts]})

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
        """その日（省略すると今日）を含む週（日曜始まり、アプリと同じ）の筋トレのふり返り。

        回数（sessions）、総負荷量、部位ごとの総負荷量と割合（偏り）、この週にまだ鍛えていない部位、先週との比べ、
        前回の筋トレからの日数、直近8週の総負荷量の推移を返す。偏りや休みを責めず、次の一歩を1つだけ提案する。
        """
        sub = subject(READ_SCOPE)
        review = await queries.weekly_review(sub, day_of(day))
        return await synced(sub, views.weekly(review, await queries.catalog(sub)))

    @mcp.tool(annotations=READ)
    async def list_exercises(include_hidden: bool = False) -> dict:
        """部位と種目の一覧（アプリと同じもの）。記録の前に種目の正しい名前を確かめるときに呼ぶ。

        隠した種目は、include_hidden を true にすると出る（隠した種目も記録には使える）。
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
        name: str, body_part: str, record_type: Literal["weight_reps", "reps_only"] = "weight_reps") -> dict:
        """種目を足す（アプリにも出る）。list_exercises にない種目を記録したいときに、利用者に名前と部位を確かめてから呼ぶ。

        body_part は部位の名前（胸・背中・肩・脚など、list_exercises の部位）。record_type は、重量×回数の種目なら
        weight_reps、自重で回数だけの種目なら reps_only。同じ部位に同じ名前の種目は作れない。
        """
        sub = subject(WRITE_SCOPE)
        with training_errors():
            exercise = await commands.add_exercise(sub, name, body_part, RecordType(record_type))
        return await synced(sub, views.exercise(exercise, await queries.catalog(sub)))

    @mcp.tool(annotations=WRITE)
    async def update_exercise(
        exercise: str,
        name: str | None = None,
        body_part: str | None = None,
        hidden: bool | None = None,
    ) -> dict:
        """種目の名前・部位を変える、隠す（hidden=true）・表示に戻す（hidden=false）。変えない項目は省く（アプリにも反映される）。

        exercise は今の名前か exercise_id（隠した種目は list_exercises の include_hidden で調べる）。body_part は部位の名前。
        記録は種目の ID でつながっているので、過去の記録もそのまま新しい名前で出る。同じ部位に同じ名前の種目は作れない。
        種目を消すツールはない。使わなくなった種目は、消す代わりに hidden=true で隠す（過去の記録は残り、記録にも使える）。
        利用者の指示どおりなので、確認なしで呼んでよい。
        """
        sub = subject(WRITE_SCOPE)
        with training_errors():
            updated = await commands.update_exercise(sub, exercise, name, body_part, hidden)
        return await synced(sub, views.exercise(updated, await queries.catalog(sub)))

    # --- 体組成 ---

    @mcp.tool(annotations=WRITE)
    async def record_body(
        day: date | None = None,
        weight_kg: float | None = None,
        body_fat_pct: float | None = None,
        muscle_pct: float | None = None,
        waist_cm: float | None = None,
        memo: str | None = None,
    ) -> dict:
        """体組成（体重・体脂肪率・筋肉率・ウエスト）を、その日（省略すると今日）の手入力の記録として残す（アプリの体組成と同じ）。

        利用者が言った数字だけを渡す。その日の手入力の記録があれば、渡した項目だけを書き換える。
        食事の目標体重までの進み具合（goal_progress）は、今は別の記録（record_weight）から出す。
        体重だけを言われ、どちらに記録するか分からなければ、利用者に聞く。
        """
        sub = subject(WRITE_SCOPE)
        values = {"weight_kg": weight_kg, "body_fat_pct": body_fat_pct, "muscle_pct": muscle_pct, "waist_cm": waist_cm}
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
    async def body_progress(days: Annotated[int, Field(ge=7, le=366, description="今日までの何日分か")] = 90) -> dict:
        """体組成の推移：日ごとの体重・体脂肪率・筋肉率・ウエストと、体脂肪量・除脂肪量、直近28日の体重の週あたりの変化。

        1日の値は、項目ごとに手入力（アプリ・record_body）を先にし、手入力がなければ Health Connect の取り込み（体重計など）を使う。
        推移はグラフで見せる。増減を責めない。
        """
        sub = subject(READ_SCOPE)
        end = today()
        start = end - timedelta(days=days - 1)
        progress = await queries.body_progress(sub, start.isoformat(), end.isoformat())
        return await synced(sub, views.body_progress(progress, start.isoformat(), end.isoformat()))

    # --- 睡眠と心拍（アプリが Health Connect から取り込んだもの。読むだけ） ---

    @mcp.tool(annotations=READ)
    async def sleep_summary(days: Annotated[int, Field(ge=7, le=90, description="今日までの何日分か")] = 7) -> dict:
        """睡眠のまとめ：起きた日ごとの眠っていた時間（分）・起きていた時間・寝た時刻と起きた時刻（日本時間）と、期間の平均。

        アプリ（hlog）が Health Connect（ウォッチなど）から取り込んだもの。記録がない日は含めない。
        1日に複数の睡眠（昼寝など）があれば足し、寝た時刻・起きた時刻はいちばん長い睡眠のもの。
        推移は描けるならグラフで見せる。睡眠の短さを責めない。病気の診断はしない。
        """
        sub = subject(READ_SCOPE)
        end = today()
        start = end - timedelta(days=days - 1)
        summary = await queries.sleep_summary(sub, start.isoformat(), end.isoformat())
        return await synced(sub, views.sleep_summary(summary, start.isoformat(), end.isoformat()))

    @mcp.tool(annotations=READ)
    async def heart_rate_summary(days: Annotated[int, Field(ge=7, le=90, description="今日までの何日分か")] = 7) -> dict:
        """心拍のまとめ：日ごとの安静時心拍・平均・最低・最高（拍/分）と測った回数、期間の安静時心拍の平均。

        アプリ（hlog）が Health Connect（ウォッチなど）から取り込んだ1日のまとめ（1回ごとの値は持たない）。記録がない日は含めない。
        安静時心拍の推移は、トレーニングの疲れや回復の目安として、描けるならグラフで見せる。病気の診断はしない。
        """
        sub = subject(READ_SCOPE)
        end = today()
        start = end - timedelta(days=days - 1)
        summary = await queries.heart_rate_summary(sub, start.isoformat(), end.isoformat())
        return await synced(sub, views.heart_rate_summary(summary, start.isoformat(), end.isoformat()))


@contextmanager
def training_errors():
    """ドメインの決まりに反したときは、理由を AI に見せる（AI が言い直せるように）。"""
    try:
        yield
    except TrainingError as e:
        raise ToolError(str(e)) from e
