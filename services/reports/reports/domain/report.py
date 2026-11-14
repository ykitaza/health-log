"""レポート（集約）。Claude・ChatGPT が記録を読んで書いたまとめ。保存したら変えない（書き換えは消して作り直す）。

本文（body）は Markdown。モデルが書いた文なので、アプリでは文字として表示するだけにする（HTML やリンクは開かない）。
全体の調子（overall_tone）・ひと言の要約（headline）・分野ごとのハイライト（highlights）・次の一歩（next_steps）・
分野をまたぐ気づき（links。「つながり」）・目標の見直し（review）は、アプリが色・アイコン・指標のタイルで見せるための構造のある項目。
構造のない前の形のレポート（本文だけ）や、links・review のない前の形も読める（overall_tone は steady として扱い、指標はない）。
達成の数字（今日の達成、今週の目標、体の変化のグラフ）はアプリが記録から計算するので、レポートには持たせない。
フェーズの振り返り（kind が phase）も同じ形で、どのフェーズかを phase_id に持つ。before／after の数字はアプリが計算する。
上限は、DynamoDB の1項目（400KB）に、変更の記録と今の状態の両方が入るように決める（下の MAX_ENCODED_BYTES）。
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from typing import Literal

from reports.domain.errors import ReportError

MAX_TITLE = 100
MAX_HEADLINE = 60  # 「40字ほど」と頼み、少し超えても断らない
MAX_BODY = 20000
MAX_HIGHLIGHTS = 6
MAX_HIGHLIGHT_TEXT = 120
MAX_NEXT_STEPS = 3
MAX_NEXT_STEP_TEXT = 80
MAX_LINKS = 3
MAX_LINK_TEXT = MAX_HIGHLIGHT_TEXT
MAX_LINK_BASIS = 20  # 根拠の短い言葉（「2日」「3週」など）
MAX_REVIEW_TEXT = 200
MAX_LABEL = 20
MAX_UNIT = 10
MAX_METRIC_VALUE = 1_000_000
MAX_PERIOD_DAYS = 366
# フェーズの振り返り（kind が phase）の期間。フェーズは104週（728日）まで、療養で止まった日数だけ後ろにずれるので、3年までにする
MAX_PHASE_PERIOD_DAYS = 1096
MAX_PHASE_ID = 64  # フェーズの ID（同期の ID と同じ形。sync.registry.ID_PATTERN）
# 1人が持てるレポートの数（消したものは数えない）。一覧は全部を読むので、多くなりすぎないようにする
MAX_REPORTS = 200
# 項目を JSON（日本語は \uXXXX）にしたときの大きさの上限。変更の記録には項目と今の状態の2つが入るので、
# 2倍しても DynamoDB の1項目（400KB）に収まるようにする。日本語だけの本文 20,000 字は 120KB ほど。
# 絵文字（1字が \uXXXX\uXXXX の12バイト）が多いと字数の上限より先にこちらで断る
MAX_ENCODED_BYTES = 150_000
ID_PATTERN = re.compile(rf"^[A-Za-z0-9_-]{{1,{MAX_PHASE_ID}}}$")  # sync.registry.ID_PATTERN と同じ形（ドメインは sync を import しない）


class Kind(StrEnum):
    DAILY = "daily"  # 日のまとめ（period_start と period_end が同じ日）
    WEEKLY = "weekly"  # 週のまとめ
    MONTHLY = "monthly"  # 月のまとめ
    PHASE = "phase"  # フェーズの振り返り（期間はフェーズの開始日〜終わった日。どのフェーズかを phase_id に持つ）
    OTHER = "other"  # その他。前は保存できたが、いまは保存を受け付けない（前に保存したものを読むためにだけ残す。service.save が断る）


class Tone(StrEnum):
    GOOD = "good"  # 良い調子
    STEADY = "steady"  # いつもどおり
    CAUTION = "caution"  # 気をつけたい


class Area(StrEnum):
    TRAINING = "training"
    MEALS = "meals"
    BODY = "body"
    SLEEP = "sleep"


# 保存を受け付ける種類（other は前に保存したものを読むためにだけ残す。application/service.py の save）
SAVABLE_KINDS = (Kind.DAILY, Kind.WEEKLY, Kind.MONTHLY, Kind.PHASE)

# 同期の項目（infrastructure/sync_entities.py）とツールの入力（presentation/mcp_tools.py）の型。値は上の列挙から作る
# （列挙を足したり変えたりしたときに、3つの層が食い違わないように。並びは列挙と同じ）
ToneName = Literal[tuple(t.value for t in Tone)]  # type: ignore[valid-type]
AreaName = Literal[tuple(a.value for a in Area)]  # type: ignore[valid-type]
KindName = Literal[tuple(k.value for k in Kind)]  # type: ignore[valid-type]
SavableKindName = Literal[tuple(k.value for k in SAVABLE_KINDS)]  # type: ignore[valid-type]


@dataclass(frozen=True)
class Metric:
    """ハイライトの指標。delta は前の期間からの変化（value と同じ単位）、delta_good はその向きが良いか。"""

    label: str
    value: float
    unit: str = ""
    delta: float | None = None
    delta_good: bool | None = None


@dataclass(frozen=True)
class Highlight:
    area: Area
    tone: Tone
    text: str
    metric: Metric | None = None


class ReviewTarget(StrEnum):
    MEALS_GOAL = "meals_goal"  # 食事の目標（アプリが「食事の目標を開く」ボタンを出す）


ReviewTargetName = Literal[tuple(t.value for t in ReviewTarget)]  # type: ignore[valid-type]


@dataclass(frozen=True)
class Link:
    """分野をまたぐ気づき（つながり）。例：睡眠が短い日は、次の日の筋トレの負荷量が少ない（basis は「3日」）。"""

    from_area: Area
    to_area: Area
    text: str
    basis: str | None = None  # 根拠の短い言葉。なければ None


@dataclass(frozen=True)
class Review:
    """目標の見直しの提案。target があれば、アプリがその目標を開くボタンを出す。"""

    text: str
    target: ReviewTarget | None = None


@dataclass(frozen=True)
class Report:
    id: str
    title: str
    body: str
    kind: Kind
    period_start: date | None = None
    period_end: date | None = None
    overall_tone: Tone | None = None  # 前の形のレポートにはない（アプリは steady として見せる）
    headline: str = ""
    highlights: tuple[Highlight, ...] = ()
    next_steps: tuple[str, ...] = ()
    created_at: str = ""  # サーバーが受け付けた時刻（UTC、ISO 8601）。保存の前は空
    links: tuple[Link, ...] = ()  # 前の形のレポートにはない
    review: Review | None = None
    # 済んだ次の一歩の番号（0 から、小さい順）。アプリのチェック（同期で届く）。次の一歩の数を超える番号は持たない
    next_steps_done: tuple[int, ...] = ()
    # どのフェーズの振り返りか（kind が phase のときだけ。ほかの種類は None）
    phase_id: str | None = None

    def __post_init__(self):
        if not self.title.strip():
            raise ReportError("題が空です")
        if len(self.title) > MAX_TITLE:
            raise ReportError(f"題は{MAX_TITLE}文字までにしてください")
        if len(self.body) > MAX_BODY:
            raise ReportError(f"本文は{MAX_BODY}文字までにしてください")
        if not self.body.strip() and not self.highlights and not self.headline.strip():
            raise ReportError("本文か、headline・highlights のどれかを入れてください")
        if len(self.headline) > MAX_HEADLINE:
            raise ReportError(f"headline は{MAX_HEADLINE}文字までにしてください")
        if len(self.highlights) > MAX_HIGHLIGHTS:
            raise ReportError(f"highlights は{MAX_HIGHLIGHTS}件までにしてください")
        if len(self.next_steps) > MAX_NEXT_STEPS:
            raise ReportError(f"next_steps は{MAX_NEXT_STEPS}件までにしてください")
        for step in self.next_steps:
            if not step.strip() or len(step) > MAX_NEXT_STEP_TEXT:
                raise ReportError(f"next_steps の1件は1〜{MAX_NEXT_STEP_TEXT}文字にしてください")
        for h in self.highlights:
            if not h.text.strip() or len(h.text) > MAX_HIGHLIGHT_TEXT:
                raise ReportError(f"highlights の text は1〜{MAX_HIGHLIGHT_TEXT}文字にしてください")
            if h.metric is not None:
                _check_metric(h.metric)
        if len(self.links) > MAX_LINKS:
            raise ReportError(f"links は{MAX_LINKS}件までにしてください")
        for link in self.links:
            if not link.text.strip() or len(link.text) > MAX_LINK_TEXT:
                raise ReportError(f"links の text は1〜{MAX_LINK_TEXT}文字にしてください")
            if link.basis is not None and (not link.basis.strip() or len(link.basis) > MAX_LINK_BASIS):
                raise ReportError(f"links の basis は1〜{MAX_LINK_BASIS}文字にしてください（なければ省く）")
            if link.from_area == link.to_area:
                raise ReportError("links の from_area と to_area は違う分野にしてください（分野をまたぐ気づき）")
        if self.review is not None and (not self.review.text.strip() or len(self.review.text) > MAX_REVIEW_TEXT):
            raise ReportError(f"review の text は1〜{MAX_REVIEW_TEXT}文字にしてください")
        if any(not 0 <= i < len(self.next_steps) for i in self.next_steps_done):
            raise ReportError("next_steps_done は next_steps の番号（0 から）にしてください")
        if (self.period_start is None) != (self.period_end is None):
            raise ReportError("期間は period_start と period_end の両方を入れるか、両方とも省いてください")
        if self.period_start and self.period_end:
            if self.period_end < self.period_start:
                raise ReportError("period_end は period_start と同じか後の日にしてください")
            max_days = MAX_PHASE_PERIOD_DAYS if self.kind is Kind.PHASE else MAX_PERIOD_DAYS
            if (self.period_end - self.period_start).days >= max_days:
                raise ReportError(f"期間は{max_days}日までにしてください")
        if self.kind is Kind.PHASE:
            if not self.phase_id or not ID_PATTERN.match(self.phase_id):
                raise ReportError("フェーズの振り返り（phase）は、どのフェーズかを phase_id（list_phases の phase_id）に入れてください")
            if self.period_start is None:
                raise ReportError("フェーズの振り返り（phase）は、期間（フェーズの開始日〜終わった日）を入れてください")
        elif self.phase_id is not None:
            raise ReportError("phase_id はフェーズの振り返り（kind が phase）だけが持ちます")
        if self.kind is Kind.DAILY and (self.period_start is None or self.period_start != self.period_end):
            raise ReportError("日のまとめ（daily）は、period_start と period_end を同じ日にしてください")


def _check_metric(m: Metric) -> None:
    if not m.label.strip() or len(m.label) > MAX_LABEL:
        raise ReportError(f"指標の label は1〜{MAX_LABEL}文字にしてください")
    if len(m.unit) > MAX_UNIT:
        raise ReportError(f"指標の unit は{MAX_UNIT}文字までにしてください")
    for name, v in (("value", m.value), ("delta", m.delta)):
        if v is not None and not (math.isfinite(v) and abs(v) <= MAX_METRIC_VALUE):
            raise ReportError(f"指標の {name} は ±{MAX_METRIC_VALUE:,} までの数にしてください")
    if m.delta is None and m.delta_good is not None:
        raise ReportError("delta_good は delta を入れたときだけ使えます")


def encoded_size(value: object) -> int:
    """保存するときの JSON の大きさ（バイト）。ストアは ensure_ascii のまま書くので同じ形で数える。"""
    return len(json.dumps(value))

