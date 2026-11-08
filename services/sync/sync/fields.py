"""項目の型でよく使うもの。各コンテキストが EntitySpec の項目のモデルを書くときに使う。"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from sync.registry import ID_PATTERN


def _date(text: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise ValueError("YYYY-MM-DD で入力してください")
    date.fromisoformat(text)
    return text


def _datetime(text: str) -> str:
    if datetime.fromisoformat(text.replace("Z", "+00:00")).tzinfo is None:
        raise ValueError("時差（Z か +09:00 など）がありません")
    return text


def is_date(text: str) -> bool:
    try:
        return _date(text) == text
    except ValueError:
        return False


Day = Annotated[str, AfterValidator(_date)]  # YYYY-MM-DD
Moment = Annotated[str, AfterValidator(_datetime)]  # RFC 3339（時差つき）
Ref = Annotated[str, Field(pattern=ID_PATTERN.pattern)]  # ほかの対象の ID
SortOrder = Annotated[int, Field(ge=0, le=100000)]
Memo = Annotated[str, Field(max_length=1000)]


class FieldsModel(BaseModel):
    """項目のモデルの元。知らない項目、型の違い（"10" と 10、1 と true）、NaN・無限大を断る。"""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
