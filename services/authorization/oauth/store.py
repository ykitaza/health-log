"""ポート：認可の途中の状態とリフレッシュトークンの系列の置き場所。実装は infrastructure/stores.py に置く。

種類（request / code / refresh）とキーで、dict を出し入れする。
"""

from typing import Protocol


class Store(Protocol):
    def put(self, kind: str, key: str, data: dict, ttl_seconds: int) -> None: ...

    def get(self, kind: str, key: str) -> dict | None: ...

    def pop(self, kind: str, key: str) -> dict | None:
        """取り出すと同時に消す（認可コードを2回使わせないため）。"""
        ...
