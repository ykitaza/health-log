"""ドメインの決まり（間隔の計算の例・探すための文・grep の正規表現と抜き出し）。"""

from datetime import date, timedelta

import pytest

from words.domain import model as m
from words.domain import schedule as sch
from words.domain.errors import WordsError
from words.domain.grep import SNIPPET_MAX, compile_pattern, compile_patterns, match_fields
from words.domain.search_doc import SEARCH_DOC_VERSION, search_document, search_fields

D0 = date(2026, 11, 1)


def test_メモの例のとおりに間隔が延びる():
    s = sch.enter_hand(m.Schedule(), D0)
    assert (s.interval_days, s.due_on, s.stage) == (1, D0 + timedelta(days=1), m.Stage.UNDERSTOOD)
    intervals, day = [], D0
    for _ in range(7):
        day += timedelta(days=s.interval_days)
        s = sch.apply_recall(s, m.RecallResult.SAID, day)
        intervals.append(s.interval_days)
    assert intervals == [2, 3, 5, 8, 12, 14, 14]
    # 3日のところで使えたら 9日、次に使えたら 27日、その次は 60日
    s = sch.enter_hand(m.Schedule(), D0)
    for n in (1, 3):
        s = sch.apply_recall(s, m.RecallResult.SAID, D0 + timedelta(days=n))
    used = []
    for n in (6, 15, 42):
        s = sch.apply_use(s, D0 + timedelta(days=n))
        used.append(s.interval_days)
    assert used == [9, 27, 60] and s.stage is m.Stage.USED


def test_手札でない表現が使えたときは回数だけ():
    s = m.Schedule(interval_days=3)
    after = sch.apply_use(s, D0, in_hand=False)
    assert (after.use_count, after.last_used_on, after.interval_days, after.stage) == (1, D0, 3, None)


def test_戻すのを勧める条件():
    base = m.Expression("x", "x", "x", m.Place.HAND, m.Schedule(stage=m.Stage.UNDERSTOOD), hand_since=D0)
    assert not sch.should_suggest_demote(base, D0 + timedelta(days=44))
    assert sch.should_suggest_demote(base, D0 + timedelta(days=45))
    lapsed = m.Expression("x", "x", "x", m.Place.HAND, m.Schedule(stage=m.Stage.SAYABLE, lapse_streak=3), hand_since=D0)
    assert sch.should_suggest_demote(lapsed, D0)
    assert sch.own_ready({D0, D0 + timedelta(days=1)}) and not sch.own_ready({D0})


def test_探すための文は決まった順で空の項目を省く():
    e = m.Expression("x", "腑に落ちる", "腑に落ちる", m.Place.COLLECTED, reading="ふにおちる", meaning="納得できる",
                     register=m.Register.SPOKEN, scene="上司の説明で", use_note="納得したとき")
    tags = [(m.Tag("t1", m.TagKind.SITUATION, "会議で", 9), m.TagStatus.CONFIRMED),
            (m.Tag("t2", m.TagKind.SITUATION, "雑談で", 10), m.TagStatus.PROPOSED),
            (m.Tag("t3", m.TagKind.SITUATION, "謝る", 2), m.TagStatus.REJECTED),
            (m.Tag("t4", m.TagKind.FEELING, "安堵", 0), m.TagStatus.CONFIRMED)]
    encounters = [m.Encounter(f"e{i}", "x", scene=f"場面{i}", surrounding_text="前後", title="本",
                              created_at=f"2026-11-0{i}T00:00:00.000Z") for i in range(1, 8)]
    assert SEARCH_DOC_VERSION == 1
    assert search_document(e, tags, encounters) == "\n".join([
        "表現：腑に落ちる", "読み：ふにおちる", "意味：納得できる", "硬さ：話し言葉", "使う場面：会議で、雑談で", "気持ち：安堵",
        "こういう時に使えそう：納得したとき", "場面：上司の説明で", "出会いの場面：場面7、場面6、場面5、場面4、場面3"])
    assert "surrounding_text" not in search_fields(e, tags, encounters)
    assert search_fields(e, tags, encounters, extra=True)["title"] == "本"


@pytest.mark.parametrize("pattern", ["(a+)+", "a{2}", "a\\d", "", "  ", "^$", "!?", "[abc", "a]", "x" * 51, "[]"])
def test_使えないパターンを断る(pattern):
    with pytest.raises(WordsError):
        compile_pattern(pattern)


def test_パターンの数は8個まで():
    with pytest.raises(WordsError):
        compile_patterns([])
    with pytest.raises(WordsError):
        compile_patterns(["a"] * 9)
    assert len(compile_patterns(["a"] * 8)) == 8


@pytest.mark.parametrize("pattern, value, hit", [
    ("フニオチ", "腑に落ちる（ふにおちる）", True),  # カタカナとひらがな
    ("ＡＢＣ", "abc", True),  # 全角と半角
    ("腑.落", "腑に落ちる", True),
    ("^腑", "腑に落ちる", True),
    ("落ちる$", "腑に落ちる。", True),  # 句読点は除いてから比べる
    ("励ま|慰め", "そっと慰める", True),
    ("[ぁ-ん]+る", "尽きる", True),
    ("励ます", "慰める", False),
])
def test_正規化してから比べる(pattern, value, hit):
    count, best = match_fields({"text": value}, [compile_pattern(pattern)])
    assert bool(count) == hit


def test_抜き出しは前後15文字で40文字まで():
    long = "あ" * 30 + "腑に落ちる" + "い" * 30
    _, best = match_fields({"note": long}, [compile_pattern("腑に落")])
    assert best.snippet == "あ" * 15 + "腑に落ちる" + "い" * 13  # 当たった所（腑に落）の前後15文字ずつ
    _, best = match_fields({"note": "あ" * 100}, [compile_pattern("あ+")])
    assert len(best.snippet) == SNIPPET_MAX


def test_いちばん上の項目の抜き出しを返し_当たったパターンを数える():
    fields = {"note": "励ますときに", "text": "元気出して", "meaning": "相手を励ます"}
    count, best = match_fields(fields, [compile_pattern("励ます"), compile_pattern("元気"), compile_pattern("なし")])
    assert count == 2 and best.field == "text"
