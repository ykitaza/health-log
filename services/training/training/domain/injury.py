"""ケガの記録（injury）と、その後の振り返り（injury_review）。筋トレで痛めたときの PDCA を回すためのもの。

  ケガ（Injury）           いつ・どこを（部位と左右）・どの種目の・どの場面で・何が起きたか、原因の自己分析と次の直し方、
                           直している途中か直せたか（直せた日）
  振り返り（InjuryReview） その後に試した日と結果（直せた・まだ・痛んだ）とメモ。ケガ1件に何件でも（上限まで）

原因（cause）と直し方（fix）は本人の言葉をそのまま持つ。AI は推測で埋めない（言っていなければ空のまま）。
痛みの強さ・体調・診断は持たない。
上限は、アプリ（apps/mobile/lib/__tests__/server-limits.test.ts）がこのファイルを正規表現で読んで突き合わせるので、
「名前 = 整数」の1行で書く（区切りの _ や式を使わない）。部位の一覧も、1行に1つの部位で書く。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from training.domain.errors import TrainingError

MAX_INJURIES = 200  # 1人が持てるケガの数（消したものは数えない）
MAX_REVIEWS_PER_INJURY = 100  # ケガ1件あたりの振り返りの数
MAX_LIST_INJURIES = 50  # list_injuries が一度に返すケガの数
MAX_LIST_REVIEWS = 20  # list_injuries がケガ1件に付けて返す振り返りの数（新しいものから）
MAX_PHASE = 100  # 場面（例：ベンチプレスの3セット目、下ろしたとき）
MAX_SYMPTOM = 500  # 症状（何が起きたか）
MAX_CAUSE = 500  # 原因の自己分析（本人の言葉）
MAX_FIX = 500  # 次の直し方（本人の言葉）
MAX_REVIEW_NOTE = 500  # 振り返りのメモ

Side = Literal["left", "right"]
Status = Literal["fixing", "fixed"]  # 直している途中・直せた
ReviewResult = Literal["fixed", "not_yet", "pain"]  # 直せた・まだ・痛んだ
SIDE_NAMES = {"left": "左", "right": "右"}
STATUS_NAMES = {"fixing": "直している途中", "fixed": "直せた"}
RESULT_NAMES = {"fixed": "直せた", "not_yet": "まだ", "pain": "痛んだ"}


@dataclass(frozen=True)
class Site:
    name: str  # 日本語の名前（MCP の表示用）
    kind: Literal["muscle", "joint"]
    sided: bool  # 左右があるか（あれば side で left・right を持つ）


# 部位のコード。左右のある部位は、左右を side で持つ（コードは左右で分けない）
SITES: dict[str, Site] = {
    "shoulder_front": Site("三角筋（前）", "muscle", True),
    "chest": Site("胸", "muscle", True),
    "biceps": Site("上腕二頭筋", "muscle", True),
    "forearm": Site("前腕", "muscle", True),
    "trapezius": Site("僧帽筋", "muscle", True),
    "abs": Site("腹筋", "muscle", False),
    "obliques": Site("腹斜筋", "muscle", True),
    "quads": Site("大腿四頭筋", "muscle", True),
    "shins": Site("すね", "muscle", True),
    "shoulder_rear": Site("三角筋（後ろ）", "muscle", True),
    "triceps": Site("上腕三頭筋", "muscle", True),
    "lats": Site("広背筋", "muscle", True),
    "upper_back": Site("脊柱起立筋（背中上部）", "muscle", True),
    "lower_back": Site("脊柱起立筋（腰の筋肉）", "muscle", True),
    "glutes": Site("お尻", "muscle", True),
    "hamstrings": Site("ハムストリングス", "muscle", True),
    "calves": Site("ふくらはぎ", "muscle", True),
    "neck": Site("首", "joint", False),
    "shoulder_joint": Site("肩（関節）", "joint", True),
    "elbow": Site("肘", "joint", True),
    "wrist": Site("手首", "joint", True),
    "waist": Site("腰（関節・下背部）", "joint", False),
    "hip": Site("股関節", "joint", True),
    "knee": Site("膝", "joint", True),
    "ankle": Site("足首", "joint", True),
}
SiteCode = Literal[tuple(SITES)]  # type: ignore[valid-type]  # 同期の項目とツールの入力の型（SITES のキー）


def site_label(site: str, side: str | None) -> str:
    """表示の名前（例：「左の肘」「腹筋」）。左右のない部位、左右が分からないときは部位の名前だけ。"""
    name = SITES[site].name
    return f"{SIDE_NAMES[side]}の{name}" if side and SITES[site].sided else name


@dataclass(frozen=True)
class Injury:
    id: str
    occurred_on: str  # 痛めた日（YYYY-MM-DD）
    site: str  # SITES のコード
    side: str | None  # left・right。左右のない部位と、左右を言っていないときは None
    exercise_id: str | None  # そのときの種目（なければ None）
    phase: str  # 場面
    symptom: str  # 症状
    cause: str  # 原因の自己分析（本人の言葉。言っていなければ空）
    fix: str  # 次の直し方（本人の言葉。言っていなければ空）
    status: str  # fixing・fixed
    fixed_on: str | None  # 直せたにした日（直している途中なら None）
    created_at: str = ""  # サーバーが受け付けた時刻（並びに使う）


@dataclass(frozen=True)
class InjuryReview:
    id: str
    injury_id: str
    date: str  # 試した日（YYYY-MM-DD）
    result: str  # fixed・not_yet・pain
    note: str = ""
    exercise_id: str | None = None  # 試した種目（なければ None）
    created_at: str = ""


def _text(what: str, value: str, limit: int) -> str:
    value = value.strip()
    if len(value) > limit:
        raise TrainingError(f"{what}は{limit}文字までにしてください（今は{len(value)}文字）")
    return value


def check_injury(i: Injury) -> Injury:
    """MCP から書くケガを確かめ、文字の前後の空白を除いたものを返す。"""
    if i.site not in SITES:
        raise TrainingError(f"部位のコード {i.site} はありません。使えるコード：{', '.join(SITES)}")
    if i.side is not None and i.side not in SIDE_NAMES:
        raise TrainingError("左右は left か right にしてください（左右のない部位・分からないときは省く）")
    if i.side is not None and not SITES[i.site].sided:
        raise TrainingError(f"{SITES[i.site].name}には左右がありません。side は省いてください")
    if i.status not in STATUS_NAMES:
        raise TrainingError("状態は fixing（直している途中）か fixed（直せた）にしてください")
    # 直せたで直せた日がないもの（アプリが状態だけを送り、直せた日がまだ届いていないなど）は、読めるように断らない
    if i.status == "fixing" and i.fixed_on is not None:
        raise TrainingError("直せた日（fixed_on）は、状態が fixed のときだけ入れてください")
    if i.fixed_on is not None and i.fixed_on < i.occurred_on:
        raise TrainingError(f"直せた日（{i.fixed_on}）は、痛めた日（{i.occurred_on}）と同じか後の日にしてください")
    return Injury(i.id, i.occurred_on, i.site, i.side, i.exercise_id, _text("場面", i.phase, MAX_PHASE),
                  _text("症状", i.symptom, MAX_SYMPTOM), _text("原因", i.cause, MAX_CAUSE),
                  _text("直し方", i.fix, MAX_FIX), i.status, i.fixed_on, i.created_at)


def check_review(r: InjuryReview) -> InjuryReview:
    if r.result not in RESULT_NAMES:
        raise TrainingError("結果は fixed（直せた）・not_yet（まだ）・pain（痛んだ）のどれかにしてください")
    return InjuryReview(r.id, r.injury_id, r.date, r.result, _text("メモ", r.note, MAX_REVIEW_NOTE), r.exercise_id,
                        r.created_at)
