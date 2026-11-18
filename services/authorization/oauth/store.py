"""ポート：認可の途中の状態とリフレッシュトークンの系列の置き場所。実装は infrastructure/stores.py に置く。

種類（request / code / refresh）とキーで、dict を出し入れする。
"""

from typing import Protocol


class ConditionFailed(Exception):
    """条件つきの put で、保存済みのものが期待と違った（ないときも含む）。"""


class Store(Protocol):
    def put(self, kind: str, key: str, data: dict, ttl_seconds: int, *,
            expected: tuple[str, str] | None = None) -> None:
        """置く。expected=(項目, 値) を渡すと、保存済みのものの data[項目] がその値のときだけ置き換え、
        違う・ないときは ConditionFailed を投げる（リフレッシュトークンのローテーションで、読んでから書くまでの間に
        入ったほかの更新を上書きしないため）。項目に使えるのは current_hash だけ。
        """
        ...

    def get(self, kind: str, key: str) -> dict | None: ...

    def pop(self, kind: str, key: str) -> dict | None:
        """取り出すと同時に消す（認可コードを2回使わせないため）。"""
        ...
