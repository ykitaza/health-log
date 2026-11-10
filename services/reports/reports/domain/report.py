"""レポート（集約）。Claude・ChatGPT が記録を読んで書いたまとめ。保存したら変えない（書き換えは消して作り直す）。

本文（body）は Markdown。モデルが書いた文なので、アプリでは文字として表示するだけにする（HTML やリンクは開かない）。
全体の調子（overall_tone）・ひと言の要約（headline）・分野ごとのハイライト（highlights）・次の一歩（next_steps）・
分野をまたぐ気づき（links。「つながり」）・目標の見直し（review）は、アプリが色・アイコン・指標のタイルで見せるための構造のある項目。
構造のない前の形のレポート（本文だけ）や、links・review のない前の形も読める（overall_tone は steady として扱い、指標はない）。
達成の数字（今日の達成、今週の目標、体の変化のグラフ）はアプリが記録から計算するので、レポートには持たせない。
上限は、DynamoDB の1項目（400KB）に、変更の記録と今の状態の両方が入るように決める（下の MAX_ENCODED_BYTES）。
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date
from enum import StrEnum

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
# 1人が持てるレポートの数（消したものは数えない）。一覧は全部を読むので、多くなりすぎないようにする
MAX_REPORTS = 200
# 項目を JSON（日本語は \uXXXX）にしたときの大きさの上限。変更の記録には項目と今の状態の2つが入るので、
# 2倍しても DynamoDB の1項目（400KB）に収まるようにする。日本語だけの本文 20,000 字は 120KB ほど。
# 絵文字（1字が \uXXXX\uXXXX の12バイト）が多いと字数の上限より先にこちらで断る
MAX_ENCODED_BYTES = 150_000


class Kind(StrEnum):
    DAILY = "daily"  # 日のまとめ（period_start と period_end が同じ日）
    WEEKLY = "weekly"  # 週のまとめ
    MONTHLY = "monthly"  # 月のまとめ
    OTHER = "other"  # その他（種目の分析など）


class Tone(StrEnum):
    GOOD = "good"  # 良い調子
    STEADY = "steady"  # いつもどおり
    CAUTION = "caution"  # 気をつけたい


class Area(StrEnum):
    TRAINING = "training"
    MEALS = "meals"
    BODY = "body"
    SLEEP = "sleep"


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
        if (self.period_start is None) != (self.period_end is None):
            raise ReportError("期間は period_start と period_end の両方を入れるか、両方とも省いてください")
        if self.period_start and self.period_end:
            if self.period_end < self.period_start:
                raise ReportError("period_end は period_start と同じか後の日にしてください")
            if (self.period_end - self.period_start).days >= MAX_PERIOD_DAYS:
                raise ReportError(f"期間は{MAX_PERIOD_DAYS}日までにしてください")
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

