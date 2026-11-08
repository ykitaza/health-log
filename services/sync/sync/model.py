"""変更と今の状態、当てはめの決まり。外の仕組み（DB や HTTP）は知らない。

当てはめは項目ごとに「いちばん強い変更の値」を残す。強さは (手入力か, 時刻, seq) の順に比べる。
時刻が違えば、届いた順番によらず同じ結果になる。時刻が同じときは、あとに受け付けた方（seq の大きい方）が勝つ
（MCP が同じミリ秒の中で「記録 → 修正」と続けて書いても、修正が残るように）。
同じ change_id は2回目から当てはめない（エンジンが duplicate にする）。
消えているかどうかは delete と restore だけで決める（update では戻らない＝削除が勝つ）。
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timezone

OPS = ("create", "update", "delete", "restore")
APP_ORIGINS = ("app", "import")  # アプリが名乗れるもの

Key = tuple[int, str, int]  # (手入力か, 時刻, seq)


def to_timestamp(value: datetime) -> str:
    """UTC、ミリ秒までの文字列にそろえる（文字列のまま時刻の順に比べられる）。"""
    value = value.astimezone(timezone.utc)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"


def parse_timestamp(text: str) -> str:
    """RFC 3339 の時刻を読み、to_timestamp の形にする。時差のないものは断る。"""
    value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("時差（Z か +09:00 など）がありません")
    return to_timestamp(value)


def utc_now() -> str:
    return to_timestamp(datetime.now(timezone.utc))


@dataclass(frozen=True)
class Change:
    change_id: str
    entity_type: str
    entity_id: str
    parent_id: str | None
    op: str
    fields: dict | None
    changed_at: str
    origin: str
    device_id: str | None = None
    received_at: str = ""  # サーバーが決める
    seq: int = 0  # サーバーが決める
    # 親と一緒に保存する種類（例：食事の品目は食事と一緒）なら、親の種類。種類の登録（Registry）から決まる
    parent_type: str | None = None

    @property
    def key(self) -> Key:
        # 取り込み（import）は手入力より弱い。端末の時計が進んでいても、受け付けた時刻で切る
        rank = 0 if self.origin == "import" else 1
        return (rank, min(self.changed_at, self.received_at or self.changed_at), self.seq)

    @property
    def doc_key(self) -> tuple[str, str]:
        """保存の単位。親と一緒に保存する種類は、親に入れる。"""
        return (self.parent_type, self.parent_id) if self.parent_type else (self.entity_type, self.entity_id)

    def record(self) -> dict:
        """変更の記録（API の ChangeRecord の形）。"""
        return {
            "seq": self.seq, "change_id": self.change_id, "entity_type": self.entity_type,
            "entity_id": self.entity_id, "parent_id": self.parent_id, "op": self.op, "fields": self.fields,
            "changed_at": self.changed_at, "received_at": self.received_at, "origin": self.origin,
            "device_id": self.device_id,
        }

    @classmethod
    def from_record(cls, d: dict) -> Change:
        return cls(**d)


@dataclass
class EntityState:
    """1つの対象の今の状態。項目ごとに、値と勝った変更の強さを持つ。"""

    entity_type: str
    entity_id: str
    parent_id: str | None
    values: dict = field(default_factory=dict)  # 項目 → 値
    keys: dict = field(default_factory=dict)  # 項目 → 勝った変更の強さ（Key）
    deletion: tuple[bool, Key] | None = None  # 消えているか、それを決めた変更の強さ
    created_at: str = ""
    updated_at: str = ""
    seq: int = 0

    @property
    def deleted(self) -> bool:
        return bool(self.deletion and self.deletion[0])

    def apply(self, change: Change) -> None:
        key = change.key
        if change.op in ("create", "update"):
            for name, value in (change.fields or {}).items():
                if name not in self.keys or key > self.keys[name]:
                    self.values[name], self.keys[name] = value, key
        else:  # delete・restore
            if self.deletion is None or key > self.deletion[1]:
                self.deletion = (change.op == "delete", key)
        at = key[1]
        self.created_at = min(self.created_at, at) if self.created_at else at
        self.updated_at = max(self.updated_at, at)
        self.seq = max(self.seq, change.seq)

    def view(self) -> dict:
        """API に出す形（EntityState）。勝った変更の強さは出さない。"""
        return {
            "entity_type": self.entity_type, "entity_id": self.entity_id, "parent_id": self.parent_id,
            "fields": dict(self.values), "deleted": self.deleted,
            "created_at": self.created_at, "updated_at": self.updated_at,
            "deleted_at": self.deletion[1][1] if self.deleted else None, "seq": self.seq,
        }

    def to_json(self) -> dict:
        return {
            "entity_type": self.entity_type, "entity_id": self.entity_id, "parent_id": self.parent_id,
            "values": self.values, "keys": {k: list(v) for k, v in self.keys.items()},
            "deletion": None if self.deletion is None else [self.deletion[0], list(self.deletion[1])],
            "created_at": self.created_at, "updated_at": self.updated_at, "seq": self.seq,
        }

    @classmethod
    def from_json(cls, d: dict) -> EntityState:
        deletion = None if d["deletion"] is None else (d["deletion"][0], tuple(d["deletion"][1]))
        return cls(d["entity_type"], d["entity_id"], d["parent_id"], d["values"],
                   {k: tuple(v) for k, v in d["keys"].items()}, deletion, d["created_at"], d["updated_at"], d["seq"])


@dataclass
class Doc:
    """保存の単位：1つの対象と、その子（食事なら品目）。"""

    entity_type: str
    entity_id: str
    own: EntityState | None = None  # 子が先に届いたときは、まだない
    children: dict[str, EntityState] = field(default_factory=dict)

    @property
    def key(self) -> tuple[str, str]:
        return (self.entity_type, self.entity_id)

    def apply(self, change: Change) -> EntityState:
        """当てはめて、変わった対象の状態を返す。"""
        if change.parent_type:
            state = self.children.setdefault(
                change.entity_id, EntityState(change.entity_type, change.entity_id, change.parent_id))
        else:
            if self.own is None:
                self.own = EntityState(change.entity_type, change.entity_id, None)
            state = self.own
        state.apply(change)
        return state

    def states(self) -> list[EntityState]:
        return ([self.own] if self.own else []) + [self.children[k] for k in sorted(self.children)]

    def to_json(self) -> dict:
        return {
            "entity_type": self.entity_type, "entity_id": self.entity_id,
            "own": self.own.to_json() if self.own else None,
            "children": {k: v.to_json() for k, v in self.children.items()},
        }

    @classmethod
    def from_json(cls, d: dict) -> Doc:
        return cls(d["entity_type"], d["entity_id"], EntityState.from_json(d["own"]) if d["own"] else None,
                   {k: EntityState.from_json(v) for k, v in d["children"].items()})


@dataclass(frozen=True)
class LogEntry:
    """変更の記録1件と、当てはめたあとの対象の状態。"""

    change: Change
    state: dict

    def to_json(self) -> dict:
        return {"change": self.change.record(), "state": self.state}

    @classmethod
    def from_json(cls, d: dict) -> LogEntry:
        return cls(Change.from_record(d["change"]), d["state"])


def stamped(change: Change, received_at: str, seq: int) -> Change:
    return replace(change, received_at=received_at, seq=seq)
