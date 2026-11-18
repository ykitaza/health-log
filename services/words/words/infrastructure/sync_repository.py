"""リポジトリの実装（同期の仕組みの上。テーブルは WordsTable）。読むのは今の状態、書くのは変更の記録（origin は mcp）。

書く前に、アプリから届く変更と同じ決まり（sync_entities.py）で確かめる。
読めない状態（項目がそろっていない、値が決まりに合わない）は飛ばし、ログに残す（残りは返す）。
利用者のことばの今の状態は全部まとめて読む（grep_words が全部を見るため。5,000件で約10MB）。
Lambda が温かいあいだは、SYNC#HEAD の seq が変わっていなければ、読んだものを使い回す（中身は読み取り専用の型）。
"""

from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from functools import partial

import anyio

from sync.engine import SyncEngine
from sync.model import Change, EntityState
from sync.registry import Rejection
from words.domain import model as m
from words.domain.catalog import SEED_SOURCES, SEED_TAGS
from words.domain.errors import WordsError
from words.domain.schedule import JST
from words.infrastructure.sync_entities import (
    ENCOUNTER,
    EXPRESSION,
    EXPRESSION_TAG,
    LISTEN_SESSION,
    REQUIRED,
    SOURCE,
    TAG,
    USAGE,
)

logger = logging.getLogger(__name__)


def _day(value) -> date | None:
    return date.fromisoformat(value) if value else None


def _complete(state: EntityState, entity_type: str) -> bool:
    return not state.deleted and set(REQUIRED[entity_type]) <= state.values.keys()


def expression_from_state(state: EntityState) -> m.Expression | None:
    v = state.values
    if not _complete(state, EXPRESSION):
        return None
    try:
        place = m.Place(v["place"])
        schedule = m.Schedule(
            stage=m.Stage(v["stage"]) if v.get("stage") and place is m.Place.HAND else None,
            interval_days=int(v.get("interval_days") or 1),
            due_on=_day(v.get("due_on")) if place is m.Place.HAND else None,
            listened_at=v.get("listened_at"),
            listen_count=int(v.get("listen_count") or 0),
            use_count=int(v.get("use_count") or 0),
            last_used_on=_day(v.get("last_used_on")),
        )
        if place is m.Place.HAND and schedule.stage is None:
            schedule = replace(schedule, stage=m.Stage.UNDERSTOOD)
        return m.Expression(
            id=state.entity_id, text=v["text"], normalized_key=v["normalized_key"], place=place, schedule=schedule,
            source_id=v.get("source_id"), scene=v.get("scene") or "", note=v.get("note") or "",
            star=bool(v.get("star")), moved_at=v.get("moved_at"), hand_since=_day(v.get("hand_since")),
            reading=v.get("reading") or "", use_note=v.get("use_note") or "", meaning=v.get("meaning") or "",
            nuance=v.get("nuance") or "", register=m.Register(v["register"]) if v.get("register") else None,
            register_by=m.By(v["register_by"]) if v.get("register_by") else None,
            examples=tuple(_example(x) for x in v.get("examples") or ()), similar=tuple(v.get("similar") or ()),
            usefulness=v.get("usefulness"), usefulness_reason=v.get("usefulness_reason") or "",
            usefulness_until=_day(v.get("usefulness_until")), enriched_at=v.get("enriched_at"),
            created_at=state.created_at, updated_at=state.updated_at)
    except (ValueError, KeyError, TypeError) as e:
        logger.warning("読めない expression を飛ばしました（id=%s）: %s", state.entity_id, e)
        return None


def encounter_from_state(state: EntityState) -> m.Encounter | None:
    v = state.values
    if not _complete(state, ENCOUNTER):
        return None
    try:
        return m.Encounter(
            id=state.entity_id, expression_id=v["expression_id"], source_id=v.get("source_id"),
            title=v.get("title") or "", locator=v.get("locator") or "", met_on=_day(v.get("met_on")),
            time_hint=v.get("time_hint") or "", scene=v.get("scene") or "",
            surrounding_text=v.get("surrounding_text") or "", wording=v.get("wording") or "",
            captured_via=v.get("captured_via") or "app", note=v.get("note") or "", created_at=state.created_at)
    except (ValueError, KeyError, TypeError) as e:
        logger.warning("読めない encounter を飛ばしました（id=%s）: %s", state.entity_id, e)
        return None


def _example(x: dict) -> m.Example:
    return m.Example(x["text"], m.By(x["origin"]), bool(x.get("confirmed")), x.get("created_at") or "",
                     x.get("updated_at") or "")


def usage_from_state(state: EntityState) -> m.Usage | None:
    v = state.values
    if not _complete(state, USAGE):
        return None
    try:
        return m.Usage(state.entity_id, v["expression_id"], date.fromisoformat(v["used_on"]), v.get("scene") or "",
                       v.get("note") or "", state.created_at)
    except (ValueError, KeyError, TypeError) as e:
        logger.warning("読めない usage を飛ばしました（id=%s）: %s", state.entity_id, e)
        return None


def listen_from_state(state: EntityState) -> m.ListenSession | None:
    v = state.values
    if not _complete(state, LISTEN_SESSION):
        return None
    try:
        return m.ListenSession(state.entity_id, v["started_at"], date.fromisoformat(v["listened_on"]),
                               int(v["seconds"]), int(v["items"]))
    except (ValueError, KeyError, TypeError) as e:
        logger.warning("読めない listen_session を飛ばしました（id=%s）: %s", state.entity_id, e)
        return None


def link_from_state(state: EntityState) -> m.ExpressionTag | None:
    v = state.values
    if not _complete(state, EXPRESSION_TAG):
        return None
    try:
        return m.ExpressionTag(state.entity_id, v["expression_id"], v["tag_id"], m.By(v["added_by"]),
                               m.TagStatus(v["status"]), v.get("confirmed_at"))
    except (ValueError, KeyError, TypeError) as e:
        logger.warning("読めない expression_tag を飛ばしました（id=%s）: %s", state.entity_id, e)
        return None


def _merge_seed(seed, state: EntityState | None, build):
    """初期の行に、同期で変えた項目（アプリは変えた項目だけを送る）を重ねる。消えていれば None。"""
    if state is None:
        return seed
    if state.deleted:
        return None
    try:
        return build(seed, state.values)
    except (ValueError, KeyError, TypeError) as e:
        logger.warning("読めない初期の行の変更を飛ばしました（id=%s）: %s", state.entity_id, e)
        return seed


def _source(seed: m.Source | None, entity_id: str, v: dict) -> m.Source:
    return m.Source(entity_id, v.get("name", seed.name if seed else ""), v.get("icon_key", seed.icon_key if seed else "other"),
                    int(v.get("sort_order", seed.sort_order if seed else 0)), bool(v.get("hidden", seed.hidden if seed else False)),
                    seed=False)


def _tag(seed: m.Tag | None, entity_id: str, v: dict) -> m.Tag:
    return m.Tag(entity_id, m.TagKind(v.get("kind", seed.kind if seed else None)), v.get("name", seed.name if seed else ""),
                 int(v.get("sort_order", seed.sort_order if seed else 0)), bool(v.get("hidden", seed.hidden if seed else False)),
                 v.get("created_by", seed.created_by if seed else "user"))


@dataclass(frozen=True)
class WordsState:
    """利用者のことばの今の状態（消したもの、消した表現の子は入れない）。"""

    head: int
    expressions: dict[str, m.Expression]
    encounters: dict[str, tuple[m.Encounter, ...]]  # 表現の ID → 出会い（古い順）
    usages: dict[str, tuple[m.Usage, ...]]  # 表現の ID → 使えたの記録（古い順）
    links: dict[str, tuple[m.ExpressionTag, ...]]  # 表現の ID → タグのつながり（rejected も入る）
    sources: tuple[m.Source, ...]  # 並び順・ID の順
    tags: tuple[m.Tag, ...]  # 種類・並び順・ID の順
    listens: tuple[m.ListenSession, ...] = ()  # 聞いた記録（古い順）
    _tags_by_id: dict[str, m.Tag] = field(default_factory=dict)

    def tag(self, tag_id: str) -> m.Tag | None:
        return self._tags_by_id.get(tag_id)

    def source(self, source_id: str | None) -> m.Source | None:
        return next((s for s in self.sources if s.id == source_id), None) if source_id else None

    def hand(self) -> list[m.Expression]:
        return [e for e in self.expressions.values() if e.place is m.Place.HAND]

    def tags_of(self, expression_id: str) -> list[tuple[m.Tag, m.TagStatus]]:
        out = []
        for link in self.links.get(expression_id, ()):
            tag = self.tag(link.tag_id)
            if tag is not None:
                out.append((tag, link.status))
        return out


class SyncWordsRepository:
    def __init__(self, engine: SyncEngine):
        self.engine = engine
        self._cache: dict[str, WordsState] = {}
        self._lock = threading.Lock()

    async def _run(self, fn, *args):
        return await anyio.to_thread.run_sync(partial(fn, *args))

    # --- 読む ---

    def _load(self, user: str) -> WordsState:
        head = self.engine.head(user)
        with self._lock:
            cached = self._cache.get(user)
        if cached is not None and cached.head == head:
            return cached
        state = self._read(user, head)
        with self._lock:
            self._cache[user] = state
        return state

    def _read(self, user: str, head: int) -> WordsState:
        def states(entity_type: str) -> list[EntityState]:
            return [d.own for d in self.engine.docs_of_type(user, entity_type) if d.own is not None]

        expressions = {e.id: e for e in map(expression_from_state, states(EXPRESSION)) if e is not None}

        def children(items) -> dict[str, tuple]:
            grouped: dict[str, list] = {}
            for item in items:
                if item is not None and item.expression_id in expressions:
                    grouped.setdefault(item.expression_id, []).append(item)
            return {k: tuple(v) for k, v in grouped.items()}

        encounters = children(sorted((e for e in map(encounter_from_state, states(ENCOUNTER)) if e),
                                     key=lambda e: (e.created_at, e.id)))
        usages = children(sorted((u for u in map(usage_from_state, states(USAGE)) if u),
                                 key=lambda u: (u.used_on, u.created_at, u.id)))
        listens = tuple(sorted((x for x in map(listen_from_state, states(LISTEN_SESSION)) if x),
                               key=lambda x: (x.started_at, x.id)))
        links = children(link_from_state(s) for s in states(EXPRESSION_TAG))

        synced_sources = {s.entity_id: s for s in states(SOURCE)}
        sources = []
        for seed in SEED_SOURCES:
            merged = _merge_seed(seed, synced_sources.pop(seed.id, None), lambda sd, v: _source(sd, sd.id, v))
            if merged:
                sources.append(merged)
        for s in synced_sources.values():
            if _complete(s, SOURCE):
                try:
                    sources.append(_source(None, s.entity_id, s.values))
                except (ValueError, TypeError) as e:
                    logger.warning("読めない source を飛ばしました（id=%s）: %s", s.entity_id, e)
        synced_tags = {s.entity_id: s for s in states(TAG)}
        tags = []
        for seed in SEED_TAGS:
            merged = _merge_seed(seed, synced_tags.pop(seed.id, None), lambda sd, v: _tag(sd, sd.id, v))
            if merged:
                tags.append(merged)
        for s in synced_tags.values():
            if _complete(s, TAG):
                try:
                    tags.append(_tag(None, s.entity_id, s.values))
                except (ValueError, TypeError) as e:
                    logger.warning("読めない tag を飛ばしました（id=%s）: %s", s.entity_id, e)
        sources.sort(key=lambda s: (s.sort_order, s.id))
        tags.sort(key=lambda t: (t.kind != m.TagKind.SITUATION, t.sort_order, t.id))
        return WordsState(head, expressions, encounters, usages, links, tuple(sources), tuple(tags), listens,
                          {t.id: t for t in tags})

    async def state(self, user: str) -> WordsState:
        return await self._run(self._load, user)

    # --- 書く ---

    def change(self, entity_type: str, entity_id: str, op: str, fields: dict | None = None) -> Change:
        """MCP の変更。create・update は、アプリから届く変更と同じ決まりで確かめる。"""
        if op in ("create", "update"):
            result = self.engine.registry.check_change(entity_type, entity_id, op, fields)
            if isinstance(result, Rejection):
                details = "、".join(f"{e['field']}：{e['message']}" for e in result.errors)
                raise WordsError(f"保存できない値です（{result.message}{'：' + details if details else ''}）")
            fields = result
        # MCP の変更の時刻は、サーバーが受け付けた時刻（エンジンが received_at で切る）
        return Change(str(uuid.uuid4()), entity_type, entity_id, None, op, fields, self.engine.clock(), "mcp")

    def _append(self, user: str, changes: list[Change]) -> None:
        if changes:
            self.engine.append(user, changes)  # 30件ごとに分けて書く（sync.engine）

    async def append(self, user: str, changes: list[Change]) -> None:
        await self._run(self._append, user, changes)

    async def last_app_sync_at(self, user: str) -> str | None:
        """ことばのアプリから最後に同期で受け付けた時刻（日本時間）。まだなければ None。"""
        at = await self._run(self.engine.last_app_received_at, user)
        if at is None:
            return None
        return datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(JST).isoformat(timespec="seconds")
