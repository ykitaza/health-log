"""対象の種類の登録と、送られた変更の確かめ。

種類ごとの決まりは、各コンテキスト（食事・筋トレ）が EntitySpec で登録する。ここは決まりの中身を知らない。
項目は pydantic のモデルで書く（fields.py の FieldsModel を使う）。null にできない項目は「型 = None」と書くと、
送らなかったときは捨て、null を送ったときは断る（既定値の None は確かめないため）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

from pydantic import BaseModel, ValidationError

from sync.model import APP_ORIGINS, OPS, Change, Doc, parse_timestamp

ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
UUID_PATTERN = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
CHANGE_KEYS = {"change_id", "entity_type", "entity_id", "parent_id", "op", "fields", "changed_at", "origin"}


@dataclass(frozen=True)
class Rejection:
    code: str
    message: str
    errors: tuple[dict, ...] = ()

    def view(self) -> dict:
        return {"code": self.code, "message": self.message, "errors": list(self.errors)}


@dataclass(frozen=True)
class EntitySpec:
    fields: type[BaseModel]
    required: tuple[str, ...]  # create で要る項目
    area: str  # scope の対象（「meals」なら torelog-api/meals.read・meals.write）
    parent_type: str | None = None  # 親と一緒に保存する種類なら、親の種類（parent_id が要る）
    # 別に保存するが、親といっしょに消える種類なら（親の種類, 親の ID を持つ項目）。例：セットは種目の entry_id。
    # 大量の削除の数え方（presentation/http_api.py の _delete_groups）だけが使う
    owner: tuple[str, str] | None = None
    valid_id: Callable[[str], bool] = lambda entity_id: True
    # 項目の組み合わせの決まり（例：いつものの ID は名前から決める）。合わなければ Rejection
    check: Callable[[str, dict], Rejection | None] = lambda entity_id, fields: None
    # 並びのキー（DynamoDB の LSI by_day に入れる値）。1つの種類だけが使う。なければ None
    index_key: Callable[[Doc], str | None] | None = None
    # アプリ（端末）から受け付ける op。サーバー（MCP）だけが書く種類は、アプリからは delete だけにする（例：レポート）
    app_ops: tuple[str, ...] = OPS
    # アプリから create・update で書ける項目。None ならどれでも。サーバーが書く種類のうち、アプリが一部の項目だけを書くもの
    # （例：レポートの次の一歩の済んだ番号 next_steps_done）に使う
    app_fields: tuple[str, ...] | None = None


class Registry:
    def __init__(self):
        self.specs: dict[str, EntitySpec] = {}

    def register(self, entity_type: str, spec: EntitySpec) -> None:
        if entity_type in self.specs:
            raise ValueError(f"{entity_type} はすでに登録されています")
        self.specs[entity_type] = spec

    def types_in(self, areas: set[str]) -> set[str]:
        return {t for t, spec in self.specs.items() if spec.area in areas}

    def areas(self) -> set[str]:
        return {spec.area for spec in self.specs.values()}

    def parent_type(self, entity_type: str) -> str | None:
        spec = self.specs.get(entity_type)
        return spec.parent_type if spec else None

    def owner(self, entity_type: str) -> tuple[str, str] | None:
        spec = self.specs.get(entity_type)
        return spec.owner if spec else None

    def index_key(self, doc: Doc) -> str | None:
        spec = self.specs.get(doc.entity_type)
        return spec.index_key(doc) if spec and spec.index_key else None

    def check_fields(self, entity_type: str, op: str, fields: object, path: str = "fields") -> dict | Rejection:
        """項目を確かめ、送られた項目だけの dict を返す。"""
        spec = self.specs[entity_type]
        if not isinstance(fields, dict):
            return Rejection("invalid_fields", "fields はオブジェクトにしてください")
        try:
            model = spec.fields.model_validate(fields)
        except ValidationError as e:
            errors = tuple(
                {"field": ".".join([path, *map(str, err["loc"])]), "message": err["msg"]} for err in e.errors())
            return Rejection("invalid_fields", "項目の形が違います", errors)
        values = model.model_dump(mode="json", exclude_unset=True)
        if op == "create":
            missing = [name for name in spec.required if name not in values]
            if missing:
                return Rejection("missing_fields", "create に要る項目がありません",
                                 tuple({"field": f"{path}.{n}", "message": "必須です"} for n in missing))
        elif not values:
            return Rejection("invalid_fields", "update には変えた項目を1つ以上入れてください")
        return values

    def check_change(self, entity_type: str, entity_id: str, op: str, fields: object) -> dict | Rejection:
        """create・update の項目を、形（check_fields）と組み合わせの決まり（EntitySpec.check）の順に確かめる。
        アプリから届いた変更（parse_change）も、MCP が書く変更（各コンテキストのリポジトリ）も、ここを通す。"""
        values = self.check_fields(entity_type, op, fields)
        if isinstance(values, Rejection):
            return values
        rejection = self.specs[entity_type].check(entity_id, values)
        return values if rejection is None else rejection

    def parse_change(self, raw: dict, allowed_types: set[str], device_id: str | None) -> Change | Rejection:
        """アプリから届いた変更を確かめる。change_id は呼ぶ側が確かめておく。"""
        unknown = set(raw) - CHANGE_KEYS
        if unknown:
            return Rejection("invalid_fields", f"知らない項目があります：{', '.join(sorted(unknown))}")
        entity_type = raw.get("entity_type")
        spec = self.specs.get(entity_type) if isinstance(entity_type, str) else None
        if spec is None:
            return Rejection("invalid_fields", "entity_type が違います")
        if entity_type not in allowed_types:
            return Rejection("insufficient_scope", f"{entity_type} を書く scope がありません")
        entity_id, parent_id, op = raw.get("entity_id"), raw.get("parent_id"), raw.get("op")
        if not isinstance(entity_id, str) or not ID_PATTERN.match(entity_id) or not spec.valid_id(entity_id):
            return Rejection("invalid_fields", "entity_id が違います")
        if spec.parent_type:
            if parent_id is None:
                return Rejection("missing_parent_id", f"{entity_type} には parent_id（{spec.parent_type} の ID）が要ります")
            if not isinstance(parent_id, str) or not ID_PATTERN.match(parent_id):
                return Rejection("invalid_fields", "parent_id が違います")
        elif parent_id is not None:
            return Rejection("parent_id_not_allowed", f"{entity_type} には parent_id を入れません")
        if op not in OPS:
            return Rejection("invalid_fields", "op が違います")
        if op not in spec.app_ops:
            return Rejection("op_not_allowed", f"{entity_type} はアプリから {op} できません（{'・'.join(spec.app_ops)} だけ）")
        origin = raw.get("origin", "app")
        if origin not in APP_ORIGINS:
            return Rejection("invalid_fields", "origin は app か import にしてください")
        try:
            changed_at = parse_timestamp(raw["changed_at"]) if isinstance(raw.get("changed_at"), str) else None
        except ValueError:
            changed_at = None
        if changed_at is None:
            return Rejection("invalid_fields", "changed_at は RFC 3339 の時刻（時差つき）にしてください")
        fields = raw.get("fields")
        if op in ("delete", "restore"):
            if fields is not None:
                return Rejection("fields_not_allowed", f"{op} には fields を入れません")
        else:
            if spec.app_fields is not None and isinstance(fields, dict) and (extra := set(fields) - set(spec.app_fields)):
                return Rejection("op_not_allowed", f"{entity_type} はアプリから {', '.join(sorted(extra))} を書けません"
                                 f"（{'・'.join(spec.app_fields)} だけ）")
            fields = self.check_change(entity_type, entity_id, op, fields)
            if isinstance(fields, Rejection):
                return fields
        return Change(raw["change_id"].lower(), entity_type, entity_id, parent_id, op, fields, changed_at, origin,
                      device_id, parent_type=spec.parent_type)
