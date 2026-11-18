"""「聞く」の読み上げの台本（docs/words-design.md の「読み上げ（TTS）」）。

表現の項目から、決まった型で台本を作る：表現 → 読み → 説明（意味とニュアンス）→ 使い方 → 例文（1〜2個）。
区切りには SSML の <break> で間を入れる（区切りのあいだは pause の short／normal／long で 400／800／1600ms）。
既定はアプリが端末の読み上げ（Android の TTS）で同じ型の台本を読む（testdata/words/speech.json で同じ台本になることを確かめる）。
設定の「自然な声」をオンにしたときだけ、アプリ用の API（POST /v1/audio）がこの SSML を Amazon Polly（neural）で読む。
音声はどこにも置かない（毎回作る）。台本の型を変えたら SPEECH_VERSION を上げる。
"""

from __future__ import annotations

from dataclasses import dataclass
from xml.sax.saxutils import escape

from words.domain.model import By, Expression, Tag, TagKind, TagStatus

SPEECH_VERSION = 1
DEFAULT_VOICE, ENGINE = "Kazuha", "neural"
VOICES = ("Kazuha", "Takumi", "Tomoko")  # ja-JP の neural の声
SECTION_BREAK_MS, EXAMPLE_BREAK_MS, LEAD_BREAK_MS = 800, 500, 300
# 区切りのあいだの間（設定の「間」。アプリの lib/listen/pace.ts の SECTION_GAP_MS と同じ。ふつうが SECTION_BREAK_MS）
DEFAULT_PAUSE = "normal"
PAUSES = {"short": 400, "normal": SECTION_BREAK_MS, "long": 1600}
MAX_EXAMPLES_SPOKEN = 2
# 1回の読み上げの文字数の上限（Polly は1回 3,000 文字まで課金・6,000 文字まで受け付ける）。項目ごとに切り詰める
MAX_SECTION_CHARS = {"text": 200, "reading": 100, "explanation": 400, "usage": 200, "example": 200}


@dataclass(frozen=True)
class Script:
    sections: tuple[tuple[str, str], ...]  # （区切りの名前, 読む文）
    ssml: str

    @property
    def text(self) -> str:
        return "\n".join(t for _, t in self.sections)


def _cut(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def _sentence(text: str) -> str:
    return text if text.endswith(("。", "！", "？", "!", "?", "…")) else text + "。"


def spoken_examples(expression: Expression) -> list[str]:
    """読む例文：本人のもの → 確かめた Claude のもの → ほかの Claude のもの の順に2つまで。"""
    ordered = sorted(expression.examples,
                     key=lambda x: (x.origin is not By.USER, not x.confirmed))
    return [x.text for x in ordered[:MAX_EXAMPLES_SPOKEN]]


def build_script(expression: Expression, tags: list[tuple[Tag, TagStatus]], pause: str = DEFAULT_PAUSE) -> Script:
    sections: list[tuple[str, str]] = [("text", _cut(expression.text, MAX_SECTION_CHARS["text"]))]
    if expression.reading and expression.reading != expression.text:
        sections.append(("reading", "読みは、" + _sentence(_cut(expression.reading, MAX_SECTION_CHARS["reading"]))))
    explanation = " ".join(_sentence(t) for t in (expression.meaning, expression.nuance) if t.strip())
    if explanation:
        sections.append(("explanation", _cut(explanation, MAX_SECTION_CHARS["explanation"])))
    situations = [t.name for t, status in tags if t.kind is TagKind.SITUATION and status is not TagStatus.REJECTED]
    if expression.use_note.strip():
        usage = "こういう時に。" + _sentence(expression.use_note.strip())
    elif situations:
        usage = "使う場面は、" + "、".join(situations[:3]) + "。"
    else:
        usage = ""
    if usage:
        sections.append(("usage", _cut(usage, MAX_SECTION_CHARS["usage"])))
    for n, example in enumerate(spoken_examples(expression)):
        lead = "例えば。" if n == 0 else ""
        sections.append(("example", lead + _sentence(_cut(example, MAX_SECTION_CHARS["example"]))))

    parts = []
    for i, (name, text) in enumerate(sections):
        if i:
            gap = EXAMPLE_BREAK_MS if name == "example" and sections[i - 1][0] == "example" else PAUSES[pause]
            parts.append(f'<break time="{gap}ms"/>')
        if name == "example" and text.startswith("例えば。"):
            parts.append(f'例えば<break time="{LEAD_BREAK_MS}ms"/>{escape(text.removeprefix("例えば。"))}')
        else:
            parts.append(escape(text))
    return Script(tuple(sections), "<speak>" + "".join(parts) + "</speak>")
