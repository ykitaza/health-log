"""日本時間と「今日」。MCP と アプリ用の API の組み立ての場所が使う。

筋トレ・レポートのツールにも同じ JST があるが、各コンテキストはここを import しないので、それぞれが持つ。
"""

from datetime import date, datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))


def today() -> date:
    """「今日」は日本時間で決める（Lambda の時計は UTC のため）。"""
    return datetime.now(JST).date()
