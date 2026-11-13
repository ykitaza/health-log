"""1回の読み取りの間だけ、読んだ結果を使い回すための置き場（contextvars）。

period_overview のように、同じ種類の今の状態の全件読み（docs_of_type）を1回の処理の中で
何度もする場所が、範囲（read_cache_scope）を開いたときだけ有効になる。範囲の外では何もしない
（ふつうに読み直す）。非同期の処理ごとに文脈が分かれるので、同時に走るほかの処理とは混ざらない。

使い回してよいのは「読むだけ」の処理だけ。書き込みの経路（commit の材料を読む所）では
範囲を開かないこと（古い状態を掴んでしまうため）。
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from typing import Callable, Iterator, TypeVar

T = TypeVar("T")

_cache: contextvars.ContextVar[dict | None] = contextvars.ContextVar("sync_read_cache", default=None)


@contextmanager
def read_cache_scope() -> Iterator[None]:
    """この範囲の中では、cached で読んだ結果が使い回される。"""
    token = _cache.set({})
    try:
        yield
    finally:
        _cache.reset(token)


def cached(key: tuple, load: Callable[[], T]) -> T:
    """範囲の中なら、同じ key では load を最初の1回だけ呼ぶ。範囲の外では毎回呼ぶ。"""
    cache = _cache.get()
    if cache is None:
        return load()
    if key not in cache:
        cache[key] = load()
    return cache[key]
