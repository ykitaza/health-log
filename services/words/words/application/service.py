"""ことばのユースケース（MCP のツールが呼ぶ）。決まりは docs/words-design.md の「MCP」「置き場所と段階」。

読むのは利用者のことばの今の状態（WordsState）、書くのは変更の記録（リポジトリが同期の決まりで確かめる）。
1回の呼び出しの書き込みは、作業用の写し（Draft）に当ててから、まとめて1回で書く（30件ごとに分けて書くのは同期の部品）。
自動では何も消さず、自動では置き場所を変えない（例外は、また出会ったときに手札に空きがあれば入れることだけ）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from typing import Callable

from words.domain import model as m
from words.domain import schedule as sch
from words.domain.catalog import ICON_KEYS, expression_tag_id
from words.domain.errors import WordsError
from words.domain.grep import compile_patterns, match_fields
from words.domain.normalize import name_key, search_key
from words.domain.search_doc import ALL_FIELDS, DOC_FIELDS, EXTRA_FIELDS, newest_encounters, search_fields
from words.domain.similarity import MAX_CANDIDATES, is_similar
from words.infrastructure.sync_entities import (
    ENCOUNTER,
    EXPRESSION,
    EXPRESSION_TAG,
    REVIEW,
    SOURCE,
    TAG,
)
from words.infrastructure.sync_repository import SyncWordsRepository, WordsState

MAX_BATCH_CAPTURE = 30
MAX_BATCH_ENRICH = 20
MAX_GET = 10
GREP_DEFAULT_LIMIT, GREP_MAX_LIMIT = 20, 50
GET_ENCOUNTERS, GET_REVIEWS = 10, 5
MAX_PROPOSED_ON_CAPTURE = 2  # Claude が拾うときに付けるタグの案の数
MAX_MATERIAL_ITEMS = 30  # reflection_material の一覧それぞれの件数
SAME_AS_NEW = "new"


def _now_text(now: datetime) -> str:
    return now.astimezone(sch.JST).isoformat(timespec="seconds")


def jst(moment: str | None) -> str | None:
    """同期の時刻（UTC）を日本時間で返す。"""
    if not moment:
        return None
    return datetime.fromisoformat(moment.replace("Z", "+00:00")).astimezone(sch.JST).isoformat(timespec="seconds")


def _iso(day: date | None) -> str | None:
    return day.isoformat() if day else None


def schedule_fields(s: m.Schedule) -> dict:
    """間隔の項目の組（いつも一緒に書く）。"""
    return {
        "stage": s.stage.value if s.stage else None, "interval_days": s.interval_days, "due_on": _iso(s.due_on),
        "last_reviewed_on": _iso(s.last_reviewed_on), "success_streak": s.success_streak,
        "lapse_streak": s.lapse_streak, "review_count": s.review_count, "lapse_count": s.lapse_count,
        "use_count": s.use_count, "last_used_on": _iso(s.last_used_on),
    }


# --- 入力 ---


@dataclass(frozen=True)
class TagRequest:
    name: str
    kind: m.TagKind
    by: m.By


@dataclass(frozen=True)
class CaptureInput:
    text: str
    source: str | None = None
    create_source: bool = False
    source_icon: str | None = None
    tags: tuple[TagRequest, ...] = ()
    create_tags: bool = False
    use_note: str = ""
    title: str = ""
    locator: str = ""
    met_on: date | None = None
    time_hint: str = ""
    scene: str = ""
    surrounding_text: str = ""
    wording: str = ""
    note: str = ""
    star: bool = False
    want_to_use: bool = False
    same_as: str | None = None


@dataclass(frozen=True)
class EnrichInput:
    id: str
    reading: str | None = None
    meaning: str | None = None
    nuance: str | None = None
    register: m.Register | None = None
    tags: tuple[TagRequest, ...] = ()  # Claude の案として proposed で付ける
    examples: tuple[str, ...] | None = None
    similar: tuple[str, ...] | None = None
    usefulness: int | None = None
    usefulness_reason: str | None = None
    usefulness_until: date | None = None


@dataclass(frozen=True)
class TagEdit:
    id: str
    add: tuple[TagRequest, ...] = ()
    confirm: tuple[str, ...] = ()
    reject: tuple[str, ...] = ()
    create_tags: bool = False


@dataclass(frozen=True)
class GrepQuery:
    patterns: tuple[str, ...]
    fields: tuple[str, ...] | None = None
    places: tuple[m.Place, ...] = ()
    stages: tuple[m.Stage, ...] = ()
    source: str | None = None
    situations: tuple[str, ...] = ()
    feelings: tuple[str, ...] = ()
    confirmed_only: bool = False
    register: m.Register | None = None
    starred: bool | None = None
    captured_from: date | None = None
    captured_to: date | None = None
    limit: int = GREP_DEFAULT_LIMIT


@dataclass(frozen=True)
class ExpressionEdit:
    id: str
    text: str | None = None
    scene: str | None = None
    note: str | None = None
    star: bool | None = None
    use_note: str | None = None
    reading: str | None = None
    register: m.Register | None = None
    encounter_id: str | None = None
    encounter: dict | None = None  # 直す出会いの項目（title・locator・met_on・time_hint・scene・surrounding_text・wording・note・source）


# --- 作業用の写し ---


@dataclass
class Draft:
    """1回の呼び出しで書くものを、今の状態の写しに当てながら集める。"""

    state: WordsState
    repo: SyncWordsRepository
    expressions: dict[str, m.Expression] = field(default_factory=dict)
    encounter_counts: dict[str, int] = field(default_factory=dict)
    links: dict[str, dict[str, m.ExpressionTag]] = field(default_factory=dict)  # 表現 → タグの ID → つながり
    sources: list[m.Source] = field(default_factory=list)
    tags: list[m.Tag] = field(default_factory=list)
    changes: list = field(default_factory=list)

    def __post_init__(self):
        self.expressions = dict(self.state.expressions)
        self.encounter_counts = {k: len(v) for k, v in self.state.encounters.items()}
        self.links = {k: {link.tag_id: link for link in v} for k, v in self.state.links.items()}
        self.sources = list(self.state.sources)
        self.tags = list(self.state.tags)

    def write(self, entity_type: str, entity_id: str, op: str, fields: dict | None = None) -> None:
        self.changes.append(self.repo.change(entity_type, entity_id, op, fields))

    def hand(self) -> list[m.Expression]:
        return [e for e in self.expressions.values() if e.place is m.Place.HAND]

    def tag_named(self, name: str, kind: m.TagKind | None = None) -> m.Tag | None:
        key = name_key(name)
        return next((t for t in self.tags if name_key(t.name) == key and (kind is None or t.kind is kind)), None)

    def source_named(self, name: str) -> m.Source | None:
        key = name_key(name)
        return next((s for s in self.sources if name_key(s.name) == key), None)

    def tag(self, tag_id: str) -> m.Tag | None:
        return next((t for t in self.tags if t.id == tag_id), None)


def _similar_names(name: str, names: list[str]) -> list[str]:
    key = name_key(name)
    return [n for n in names if key and (key in name_key(n) or name_key(n) in key or is_similar(key, name_key(n)))][:5]


class WordsService:
    def __init__(self, repo: SyncWordsRepository, now: Callable[[], datetime]):
        self.repo, self.now = repo, now

    def today(self) -> date:
        return sch.business_day(self.now())

    async def _draft(self, user: str) -> Draft:
        return Draft(await self.repo.state(user), self.repo)

    async def _commit(self, user: str, draft: Draft) -> WordsState:
        await self.repo.append(user, draft.changes)
        return await self.repo.state(user)

    async def state(self, user: str) -> WordsState:
        return await self.repo.state(user)

    async def last_app_sync_at(self, user: str) -> str | None:
        return await self.repo.last_app_sync_at(user)

    # --- 拾う ---

    async def capture(self, user: str, items: list[CaptureInput]) -> list[dict]:
        if not 1 <= len(items) <= MAX_BATCH_CAPTURE:
            raise WordsError(f"拾うのは1回に1〜{MAX_BATCH_CAPTURE}件にしてください")
        draft = await self._draft(user)
        results = []
        for item in items:
            try:
                results.append(self._capture_one(draft, item))
            except WordsError as e:
                results.append({"status": "error", "text": item.text, "error": str(e)})
        state = await self._commit(user, draft)
        hand = {"count": len(state.hand()), "limit": sch.HAND_LIMIT}
        for r in results:
            if r.get("status") == "recorded":
                e = state.expressions.get(r["expression"]["id"])
                if e is not None:
                    r["expression"] = brief(e)
                r["hand"] = hand
        return results

    def _capture_one(self, draft: Draft, item: CaptureInput) -> dict:
        text = item.text.strip()
        if not text:
            raise WordsError("表現（text）が空です")
        if len(text) > m.MAX_TEXT:
            raise WordsError(f"表現は{m.MAX_TEXT}文字までにしてください")
        now, today = self.now(), self.today()
        stamp = _now_text(now)

        source_id = None
        if item.source and item.source.strip():
            source = draft.source_named(item.source)
            if source is None and not item.create_source:
                names = [s.name for s in draft.sources if not s.hidden]
                return {"status": "source_not_found", "text": text, "source": item.source,
                        "source_candidates": _similar_names(item.source, [s.name for s in draft.sources]),
                        "sources": names,
                        "message": "出会った場所が見つからないので、記録していません。似た名前ならその名前で呼び直し、"
                                   "新しい場所なら利用者に一度だけ確かめてから create_source=true で呼び直してください。"}
            if source is None:
                source = self._new_source(draft, item.source.strip(), item.source_icon)
            source_id = source.id

        target = self._find_same(draft, text, item.same_as)
        if isinstance(target, dict):
            return target  # 似た表現の候補（記録しない）

        hand_full = None
        if target is None:  # 新しく作る
            if len(draft.expressions) >= m.MAX_EXPRESSIONS:
                raise WordsError(f"表現は{m.MAX_EXPRESSIONS}件までです")
            expression_id = str(uuid.uuid4())
            to_hand = item.want_to_use and len(draft.hand()) < sch.HAND_LIMIT
            if item.want_to_use and not to_hand:
                hand_full = [brief(e) for e in draft.hand()]
            place = m.Place.HAND if to_hand else m.Place.COLLECTED
            schedule = sch.enter_hand(m.Schedule(), today) if to_hand else m.Schedule()
            fields = {"text": text, "normalized_key": search_key(text), "source_id": source_id,
                      "scene": item.scene, "note": item.note, "star": item.star, "place": place.value,
                      "moved_at": stamp, "hand_since": today.isoformat() if to_hand else None,
                      "use_note": item.use_note, **schedule_fields(schedule)}
            draft.write(EXPRESSION, expression_id, "create", fields)
            expression = m.Expression(expression_id, text, search_key(text), place, schedule, source_id,
                                      item.scene, item.note, item.star, stamp, today if to_hand else None,
                                      use_note=item.use_note)
            outcome = "promoted" if to_hand else "created"
        else:
            expression = target
            if draft.encounter_counts.get(expression.id, 0) >= m.MAX_ENCOUNTERS:
                raise WordsError(f"出会いは表現1つに{m.MAX_ENCOUNTERS}件までです")
            updates: dict = {}
            if item.star and not expression.star:
                updates["star"] = True
            if item.use_note and not expression.use_note:
                updates["use_note"] = item.use_note
            if not expression.scene and item.scene:
                updates["scene"] = item.scene
            outcome = "reencountered"
            if expression.place is m.Place.COLLECTED:
                if len(draft.hand()) < sch.HAND_LIMIT:
                    schedule = sch.enter_hand(expression.schedule, today)
                    updates.update({"place": m.Place.HAND.value, "moved_at": stamp, "hand_since": today.isoformat(),
                                    **schedule_fields(schedule)})
                    expression = replace(expression, place=m.Place.HAND, schedule=schedule, hand_since=today)
                    outcome = "promoted"
                else:
                    hand_full = [brief(e) for e in draft.hand()]
            if updates:
                draft.write(EXPRESSION, expression.id, "update", updates)
                expression = replace(expression, star=expression.star or item.star,
                                     use_note=expression.use_note or item.use_note,
                                     scene=expression.scene or item.scene)
        draft.expressions[expression.id] = expression

        encounter = {"expression_id": expression.id, "source_id": source_id, "title": item.title,
                     "locator": item.locator, "met_on": _iso(item.met_on), "time_hint": item.time_hint,
                     "scene": item.scene, "surrounding_text": item.surrounding_text, "wording": item.wording,
                     "captured_via": "mcp", "note": item.note}
        draft.write(ENCOUNTER, str(uuid.uuid4()), "create", encounter)
        draft.encounter_counts[expression.id] = draft.encounter_counts.get(expression.id, 0) + 1

        tagged = self._apply_tags(draft, expression.id, item.tags, item.create_tags, stamp)
        result = {"status": "recorded", "expression": brief(expression), "outcome": outcome,
                  "proposed_tags": tagged["proposed"], "confirmed_tags": tagged["confirmed"]}
        if tagged["not_found"]:
            result["tag_not_found"] = tagged["not_found"]
        if outcome == "promoted" and target is not None:
            result["message"] = "また出会ったので、手札に入れました（意味がわかる、間隔1日）。"
        if hand_full is not None:
            result["hand_full"] = True
            result["current_hand"] = hand_full
            result["message"] = "手札がいっぱい（10個）なので、手札には入れていません。入れ替えるなら、どれを戻すかを利用者に聞いてください。"
        return result

    def _find_same(self, draft: Draft, text: str, same_as: str | None) -> m.Expression | dict | None:
        """同じ表現（normalized_key が同じ、または same_as で選んだもの）。似たものがあれば候補（記録しない）。"""
        key = search_key(text)
        if same_as and same_as != SAME_AS_NEW:
            target = draft.expressions.get(same_as)
            if target is None:
                raise WordsError(f"same_as の表現（{same_as}）が見つかりません")
            return target
        same = sorted((e for e in draft.expressions.values() if key and e.normalized_key == key),
                      key=lambda e: (e.created_at or "~", e.id))
        if same:
            return same[0]
        if same_as == SAME_AS_NEW or not key:
            return None
        similar = [e for e in draft.expressions.values() if is_similar(key, e.normalized_key)]
        if not similar:
            return None
        similar.sort(key=lambda e: (e.created_at or "~", e.id))
        return {"status": "candidates", "text": text,
                "candidates": [brief(e) for e in similar[:MAX_CANDIDATES]],
                "message": "似た表現があるので、記録していません。同じ表現（活用や言い回しの違いだけ）なら same_as にその ID を、"
                           "別の表現なら same_as=\"new\" を入れて呼び直してください。迷うときは利用者に聞いてください。"}

    def _new_source(self, draft: Draft, name: str, icon: str | None) -> m.Source:
        if len(draft.sources) >= m.MAX_SOURCES:
            raise WordsError(f"出会った場所は{m.MAX_SOURCES}件までです")
        if len(name) > m.MAX_SOURCE_NAME:
            raise WordsError(f"出会った場所の名前は{m.MAX_SOURCE_NAME}文字までにしてください")
        icon_key = icon if icon in ICON_KEYS else "other"
        order = max((s.sort_order for s in draft.sources), default=-1) + 1
        source = m.Source(str(uuid.uuid4()), name, icon_key, order)
        draft.write(SOURCE, source.id, "create",
                    {"name": name, "icon_key": icon_key, "sort_order": order, "hidden": False})
        draft.sources.append(source)
        return source

    def _new_tag(self, draft: Draft, name: str, kind: m.TagKind, by: m.By) -> m.Tag:
        if len(draft.tags) >= m.MAX_TAGS:
            raise WordsError(f"タグは{m.MAX_TAGS}件までです")
        if not name.strip() or len(name) > m.MAX_TAG_NAME:
            raise WordsError(f"タグの名前は1〜{m.MAX_TAG_NAME}文字にしてください")
        order = max((t.sort_order for t in draft.tags if t.kind is kind), default=-1) + 1
        tag = m.Tag(str(uuid.uuid4()), kind, name.strip(), order, False, by.value)
        draft.write(TAG, tag.id, "create", {"kind": kind.value, "name": tag.name, "sort_order": order,
                                            "hidden": False, "created_by": by.value})
        draft.tags.append(tag)
        return tag

    def _apply_tags(self, draft: Draft, expression_id: str, requests: tuple[TagRequest, ...], create: bool,
                    stamp: str) -> dict:
        """タグを付ける。本人が言ったものは confirmed、Claude の案は proposed。本人が断ったタグに案は付けない。"""
        out = {"proposed": [], "confirmed": [], "not_found": []}
        links = draft.links.setdefault(expression_id, {})
        for req in requests:
            tag = draft.tag_named(req.name, req.kind)
            if tag is None:
                if not create:
                    names = [t.name for t in draft.tags if t.kind is req.kind]
                    out["not_found"].append({"name": req.name, "kind": req.kind.value,
                                             "similar": _similar_names(req.name, names)})
                    continue
                tag = self._new_tag(draft, req.name, req.kind, req.by)
            link_id = expression_tag_id(expression_id, tag.id)
            current = links.get(tag.id)
            if req.by is m.By.USER:
                if current is None or current.status is not m.TagStatus.CONFIRMED:
                    fields = {"status": m.TagStatus.CONFIRMED.value, "confirmed_at": stamp}
                    if current is None:
                        fields.update({"expression_id": expression_id, "tag_id": tag.id, "added_by": "user"})
                    draft.write(EXPRESSION_TAG, link_id, "create" if current is None else "update", fields)
                    links[tag.id] = m.ExpressionTag(link_id, expression_id, tag.id,
                                                    current.added_by if current else m.By.USER,
                                                    m.TagStatus.CONFIRMED, stamp)
                out["confirmed"].append(tag.name)
            else:
                if current is None:
                    draft.write(EXPRESSION_TAG, link_id, "create", {
                        "expression_id": expression_id, "tag_id": tag.id, "added_by": "claude",
                        "status": m.TagStatus.PROPOSED.value, "confirmed_at": None})
                    links[tag.id] = m.ExpressionTag(link_id, expression_id, tag.id, m.By.CLAUDE, m.TagStatus.PROPOSED)
                    out["proposed"].append(tag.name)
                elif current.status is m.TagStatus.PROPOSED:
                    out["proposed"].append(tag.name)
                # confirmed（本人が確かめた）と rejected（本人が断った）は変えない
        return out

    # --- 補う ---

    async def enrich(self, user: str, items: list[EnrichInput]) -> list[dict]:
        if not 1 <= len(items) <= MAX_BATCH_ENRICH:
            raise WordsError(f"補うのは1回に1〜{MAX_BATCH_ENRICH}件にしてください")
        draft = await self._draft(user)
        stamp, today = _now_text(self.now()), self.today()
        results = []
        for item in items:
            e = draft.expressions.get(item.id)
            if e is None:
                results.append({"id": item.id, "status": "not_found"})
                continue
            fields: dict = {}
            for name in ("reading", "meaning", "nuance", "usefulness_reason"):
                if (value := getattr(item, name)) is not None:
                    fields[name] = value
            kept_register = False
            if item.register is not None:
                if e.register_by is m.By.USER and e.register is not item.register:
                    kept_register = True  # 本人が決めた硬さは変えない
                elif e.register_by is not m.By.USER:
                    fields.update({"register": item.register.value, "register_by": "claude"})
            if item.examples is not None:
                fields["examples"] = list(item.examples)
            if item.similar is not None:
                fields["similar"] = list(item.similar)
            if item.usefulness is not None:
                fields["usefulness"] = item.usefulness
                until = item.usefulness_until or today + timedelta(days=sch.USEFULNESS_DAYS)
                fields["usefulness_until"] = until.isoformat()
            elif item.usefulness_until is not None:
                fields["usefulness_until"] = item.usefulness_until.isoformat()
            try:
                tagged = self._apply_tags(draft, e.id, tuple(replace(t, by=m.By.CLAUDE) for t in item.tags), False,
                                          stamp)
                if fields or tagged["proposed"]:
                    fields["enriched_at"] = stamp
                    draft.write(EXPRESSION, e.id, "update", fields)
            except WordsError as err:
                results.append({"id": item.id, "status": "error", "error": str(err)})
                continue
            result = {"id": e.id, "text": e.text, "status": "enriched",
                      "updated": sorted(k for k in fields if k != "enriched_at"), "proposed_tags": tagged["proposed"]}
            if tagged["not_found"]:
                result["tag_not_found"] = tagged["not_found"]
            if kept_register:
                result["note"] = "硬さは利用者が決めたものなので変えていません。"
            results.append(result)
        await self._commit(user, draft)
        return results

    # --- タグ ---

    async def tag_expressions(self, user: str, items: list[TagEdit]) -> list[dict]:
        if not 1 <= len(items) <= MAX_BATCH_ENRICH:
            raise WordsError(f"items は1〜{MAX_BATCH_ENRICH}件にしてください")
        draft = await self._draft(user)
        stamp = _now_text(self.now())
        results = []
        for item in items:
            e = draft.expressions.get(item.id)
            if e is None:
                results.append({"id": item.id, "status": "not_found"})
                continue
            try:
                tagged = self._apply_tags(draft, e.id, item.add, item.create_tags, stamp)
                confirmed, rejected, removed = [], [], []
                links = draft.links.setdefault(e.id, {})
                for names, decision in ((item.confirm, "confirm"), (item.reject, "reject")):
                    for name in names:
                        link = next((lk for lk in links.values()
                                     if (t := draft.tag(lk.tag_id)) and name_key(t.name) == name_key(name)), None)
                        tag = draft.tag(link.tag_id) if link else draft.tag_named(name)
                        if tag is None:
                            tagged["not_found"].append({"name": name, "similar": _similar_names(
                                name, [t.name for t in draft.tags])})
                            continue
                        if decision == "confirm":
                            self._apply_tags(draft, e.id, (TagRequest(tag.name, tag.kind, m.By.USER),), False, stamp)
                            confirmed.append(tag.name)
                        elif link is None:
                            # 付いていないタグを断られた：同じ案をくり返さないように rejected で残す
                            link_id = expression_tag_id(e.id, tag.id)
                            draft.write(EXPRESSION_TAG, link_id, "create", {
                                "expression_id": e.id, "tag_id": tag.id, "added_by": "claude",
                                "status": m.TagStatus.REJECTED.value, "confirmed_at": stamp})
                            links[tag.id] = m.ExpressionTag(link_id, e.id, tag.id, m.By.CLAUDE, m.TagStatus.REJECTED,
                                                            stamp)
                            rejected.append(tag.name)
                        elif link.added_by is m.By.USER:
                            draft.write(EXPRESSION_TAG, link.id, "delete")  # 本人が付けたものは外す（論理削除）
                            links.pop(tag.id)
                            removed.append(tag.name)
                        else:
                            draft.write(EXPRESSION_TAG, link.id, "update",
                                        {"status": m.TagStatus.REJECTED.value, "confirmed_at": stamp})
                            links[tag.id] = replace(link, status=m.TagStatus.REJECTED, confirmed_at=stamp)
                            rejected.append(tag.name)
            except WordsError as err:
                results.append({"id": item.id, "status": "error", "error": str(err)})
                continue
            result = {"id": e.id, "text": e.text, "status": "ok", "added_confirmed": tagged["confirmed"],
                      "added_proposed": tagged["proposed"], "confirmed": confirmed, "rejected": rejected,
                      "removed": removed}
            if tagged["not_found"]:
                result["tag_not_found"] = tagged["not_found"]
            results.append(result)
        state = await self._commit(user, draft)
        for r in results:
            if r.get("status") == "ok":
                r["tags"] = tag_views(state, r["id"])
        return results

    # --- 置き場所 ---

    async def move(self, user: str, expression_id: str, to: m.Place) -> dict:
        draft = await self._draft(user)
        e = draft.expressions.get(expression_id)
        if e is None:
            raise WordsError(f"表現（{expression_id}）が見つかりません")
        if e.place is to:
            return {"status": "unchanged", "expression": brief(e), "hand": self._hand_count(draft)}
        stamp, today = _now_text(self.now()), self.today()
        if to is m.Place.HAND:
            others = [h for h in draft.hand() if h.id != e.id]
            if len(others) >= sch.HAND_LIMIT:
                return {"status": "hand_full", "expression": brief(e), "current_hand": [brief(h) for h in others],
                        "hand": self._hand_count(draft),
                        "message": "手札がいっぱい（10個）です。どれを拾ったに戻すかを利用者に聞いてから、入れ替えてください。"}
            schedule = sch.enter_hand(e.schedule, today)
            hand_since = today.isoformat()
        else:
            schedule, hand_since = sch.leave_hand(e.schedule), None
        draft.write(EXPRESSION, e.id, "update", {"place": to.value, "moved_at": stamp, "hand_since": hand_since,
                                                 **schedule_fields(schedule)})
        state = await self._commit(user, draft)
        return {"status": "moved", "expression": brief(state.expressions[e.id]), "hand": self._hand_count(state)}

    @staticmethod
    def _hand_count(state) -> dict:
        return {"count": len(state.hand()), "limit": sch.HAND_LIMIT}

    # --- 振り返りと使えた ---

    def _moment(self, day: date) -> str:
        """その日の記録の時刻。今日なら今、前の日なら正午（日本時間）。"""
        now = self.now()
        if day >= sch.business_day(now):
            return _now_text(now)
        return datetime(day.year, day.month, day.day, 12, tzinfo=sch.JST).isoformat(timespec="seconds")

    async def record_use(self, user: str, expression_id: str, used_on: date | None, scene: str = "",
                         note: str = "") -> dict:
        draft = await self._draft(user)
        e = draft.expressions.get(expression_id)
        if e is None:
            raise WordsError(f"表現（{expression_id}）が見つかりません")
        today = self.today()
        day = used_on or today
        if day > today:
            raise WordsError("使えた日（used_on）は今日か前の日にしてください")
        if len(draft.state.reviews.get(e.id, ())) >= m.MAX_REVIEWS:
            raise WordsError(f"振り返りの記録は表現1つに{m.MAX_REVIEWS}件までです")
        in_hand = e.place is m.Place.HAND
        schedule = sch.apply_use(e.schedule, day, in_hand)
        fields = schedule_fields(schedule)
        if not in_hand:  # 手札でなければ、使えた回数と日だけ
            fields = {k: fields[k] for k in ("use_count", "last_used_on", "lapse_streak")}
        memo = " ".join(x.strip() for x in (scene, note) if x and x.strip())
        if memo:  # 振り返りの記録には場面とメモの項目がないので、表現のメモに本人の言葉のまま足す
            line = f"{day.isoformat()} 使えた：{memo}"
            fields["note"] = (f"{e.note}\n{line}" if e.note else line)[:m.MAX_NOTE]
        draft.write(EXPRESSION, e.id, "update", fields)
        draft.write(REVIEW, str(uuid.uuid4()), "create", {
            "expression_id": e.id, "kind": m.ReviewKind.USE.value, "result": None, "reviewed_at": self._moment(day),
            "interval_before": e.schedule.interval_days, "interval_after": schedule.interval_days,
            "session_id": None, "trigger": m.Trigger.CHAT.value})
        state = await self._commit(user, draft)
        updated = state.expressions[e.id]
        use_days = self.use_days(state, e.id)
        ready = sch.own_ready(use_days) and updated.place is m.Place.HAND
        result = {"expression": brief(updated), "interval_days": updated.schedule.interval_days,
                  "due_on": _iso(updated.schedule.due_on), "use_count": updated.schedule.use_count,
                  "own_ready": ready}
        if ready:
            result["message"] = "違う日に2回使えたので、自分の言葉にする条件を満たしました。移すかどうかを利用者に聞いてください（自動では移しません）。"
        return result

    @staticmethod
    def use_days(state: WordsState, expression_id: str) -> set[date]:
        return {sch.business_day(datetime.fromisoformat(r.reviewed_at.replace("Z", "+00:00")))
                for r in state.reviews.get(expression_id, ()) if r.kind is m.ReviewKind.USE}

    async def record_review(self, user: str, expression_id: str, result: m.RecallResult,
                            session_id: str | None = None) -> dict:
        draft = await self._draft(user)
        e = draft.expressions.get(expression_id)
        if e is None:
            raise WordsError(f"表現（{expression_id}）が見つかりません")
        if e.place is not m.Place.HAND:
            raise WordsError("振り返るのは手札の表現だけです（拾った・自分の言葉には振り返りがありません）")
        if len(draft.state.reviews.get(e.id, ())) >= m.MAX_REVIEWS:
            raise WordsError(f"振り返りの記録は表現1つに{m.MAX_REVIEWS}件までです")
        today = self.today()
        schedule = sch.apply_recall(e.schedule, result, today)
        if schedule != e.schedule:
            draft.write(EXPRESSION, e.id, "update", schedule_fields(schedule))
        draft.write(REVIEW, str(uuid.uuid4()), "create", {
            "expression_id": e.id, "kind": m.ReviewKind.RECALL.value, "result": result.value,
            "reviewed_at": _now_text(self.now()), "interval_before": e.schedule.interval_days,
            "interval_after": schedule.interval_days, "session_id": session_id, "trigger": m.Trigger.CHAT.value})
        state = await self._commit(user, draft)
        updated = state.expressions[e.id]
        out = {"expression": brief(updated), "interval_days": updated.schedule.interval_days,
               "due_on": _iso(updated.schedule.due_on), "success_streak": updated.schedule.success_streak,
               "lapse_streak": updated.schedule.lapse_streak,
               "counted": schedule != e.schedule or e.schedule.last_reviewed_on != today}
        if e.schedule.last_reviewed_on == today:
            out["note"] = "今日はもう振り返っているので、記録だけを残し、間隔は変えていません。"
        if updated.schedule.lapse_streak >= sch.DEMOTE_LAPSES:
            out["suggest_demote"] = True
            out["message"] = "出てこなかったが3回続きました。拾ったに戻すかを利用者に聞いてください（自動では戻しません）。"
        return out

    # --- 直す・消す ---

    async def update_expression(self, user: str, edit: ExpressionEdit) -> dict:
        draft = await self._draft(user)
        e = draft.expressions.get(edit.id)
        if e is None:
            raise WordsError(f"表現（{edit.id}）が見つかりません")
        fields: dict = {}
        if edit.text is not None:
            text = edit.text.strip()
            if not text:
                raise WordsError("表現（text）を空にはできません")
            fields.update({"text": text, "normalized_key": search_key(text)})
        for name in ("scene", "note", "star", "use_note", "reading"):
            if (value := getattr(edit, name)) is not None:
                fields[name] = value
        if edit.register is not None:
            fields.update({"register": edit.register.value, "register_by": "user"})  # 本人が決めた硬さ
        if fields:
            draft.write(EXPRESSION, e.id, "update", fields)
        if edit.encounter_id is not None:
            enc = next((x for x in draft.state.encounters.get(e.id, ()) if x.id == edit.encounter_id), None)
            if enc is None:
                raise WordsError(f"この表現の出会い（{edit.encounter_id}）が見つかりません")
            changes = dict(edit.encounter or {})
            if "source" in changes:
                name = changes.pop("source")
                if name:
                    source = draft.source_named(name)
                    if source is None:
                        raise WordsError(f"出会った場所「{name}」が見つかりません（list_facets の名前を使ってください）")
                    changes["source_id"] = source.id
                else:
                    changes["source_id"] = None
            if not changes:
                raise WordsError("直す出会いの項目がありません")
            draft.write(ENCOUNTER, enc.id, "update", changes)
        elif edit.encounter:
            raise WordsError("出会いを直すときは encounter_id を入れてください（get_words で調べられます）")
        if not draft.changes:
            raise WordsError("直す項目がありません")
        state = await self._commit(user, draft)
        return {"expression": full_view(state, state.expressions[e.id])}

    async def delete_expression(self, user: str, expression_id: str, confirmed: bool) -> dict:
        draft = await self._draft(user)
        e = draft.expressions.get(expression_id)
        if e is None:
            raise WordsError(f"表現（{expression_id}）が見つかりません")
        state = draft.state
        encounters, reviews = state.encounters.get(e.id, ()), state.reviews.get(e.id, ())
        links = state.links.get(e.id, ())
        summary = {"expression": brief(e), "encounter_count": len(encounters), "review_count": len(reviews)}
        if not confirmed:
            return {"status": "needs_confirmation", **summary,
                    "message": "まだ消していません。消すもの（表現と、出会い・振り返りの記録）を利用者に見せて了承を得てから、"
                               "confirmed=true で呼び直してください。手札から外したいだけなら、消さずに move_expression で拾ったに戻します。"}
        for child_type, items in ((ENCOUNTER, encounters), (REVIEW, reviews), (EXPRESSION_TAG, links)):
            for item in items:
                draft.write(child_type, item.id, "delete")
        draft.write(EXPRESSION, e.id, "delete")
        await self._commit(user, draft)
        return {"status": "deleted", **summary}

    # --- 出会った場所 ---

    async def add_source(self, user: str, name: str, icon: str | None) -> dict:
        draft = await self._draft(user)
        name = name.strip()
        if not name:
            raise WordsError("名前が空です")
        existing = draft.source_named(name)
        if existing is not None:
            return {"status": "exists", "source": source_view(existing)}
        source = self._new_source(draft, name, icon)
        await self._commit(user, draft)
        return {"status": "created", "source": source_view(source)}

    # --- 読む ---

    async def facets(self, user: str, include_hidden: bool) -> dict:
        state = await self.repo.state(user)
        counts: dict[str, dict[str, int]] = {}
        for links in state.links.values():
            for link in links:
                c = counts.setdefault(link.tag_id, {"confirmed": 0, "proposed": 0})
                if link.status in (m.TagStatus.CONFIRMED, m.TagStatus.PROPOSED):
                    c[link.status.value] += 1
        source_counts: dict[str, set[str]] = {}
        for e in state.expressions.values():
            ids = {e.source_id} | {x.source_id for x in state.encounters.get(e.id, ())}
            for sid in ids - {None}:
                source_counts.setdefault(sid, set()).add(e.id)

        def tag_list(kind: m.TagKind) -> list[dict]:
            return [{"id": t.id, "name": t.name, **counts.get(t.id, {"confirmed": 0, "proposed": 0}),
                     **({"hidden": True} if t.hidden else {})}
                    for t in state.tags if t.kind is kind and (include_hidden or not t.hidden)]

        exprs = list(state.expressions.values())
        return {
            "situations": tag_list(m.TagKind.SITUATION),
            "feelings": tag_list(m.TagKind.FEELING),
            "sources": [{**source_view(s), "count": len(source_counts.get(s.id, ()))}
                        for s in state.sources if include_hidden or not s.hidden],
            "registers": {r.value: sum(e.register is r for e in exprs) for r in m.Register},
            "places": {p.value: sum(e.place is p for e in exprs) for p in m.Place},
            "stages": {s.value: sum(e.schedule.stage is s for e in exprs if e.place is m.Place.HAND) for s in m.Stage},
            "total": len(exprs),
            "hand": self._hand_count(state),
        }

    def _resolve_tags(self, state: WordsState, names: tuple[str, ...], kind: m.TagKind) -> set[str]:
        ids = set()
        for name in names:
            tag = next((t for t in state.tags if t.kind is kind and name_key(t.name) == name_key(name)), None)
            if tag is None:
                similar = _similar_names(name, [t.name for t in state.tags if t.kind is kind])
                raise WordsError(f"タグ「{name}」が見つかりません（tag_not_found）。似た名前：{'・'.join(similar) or 'なし'}。"
                                 "list_facets の名前を使ってください")
            ids.add(tag.id)
        return ids

    async def grep(self, user: str, q: GrepQuery) -> dict:
        patterns = compile_patterns(list(q.patterns))
        fields = tuple(q.fields) if q.fields else tuple(name for name, _ in DOC_FIELDS)
        if unknown := [f for f in fields if f not in ALL_FIELDS]:
            raise WordsError(f"知らない項目です：{', '.join(unknown)}（使えるのは {', '.join(ALL_FIELDS)}）")
        if not 1 <= q.limit <= GREP_MAX_LIMIT:
            raise WordsError(f"limit は1〜{GREP_MAX_LIMIT}にしてください")
        state = await self.repo.state(user)
        source_id = None
        if q.source:
            source = next((s for s in state.sources if name_key(s.name) == name_key(q.source)), None)
            if source is None:
                raise WordsError(f"出会った場所「{q.source}」が見つかりません（source_not_found）。今の一覧："
                                 f"{'・'.join(s.name for s in state.sources)}")
            source_id = source.id
        situations = self._resolve_tags(state, q.situations, m.TagKind.SITUATION)
        feelings = self._resolve_tags(state, q.feelings, m.TagKind.FEELING)
        usable = (m.TagStatus.CONFIRMED,) if q.confirmed_only else (m.TagStatus.CONFIRMED, m.TagStatus.PROPOSED)
        extra = any(f in EXTRA_FIELDS for f in fields)

        hits = []
        for e in state.expressions.values():
            if q.places and e.place not in q.places:
                continue
            if q.stages and e.schedule.stage not in q.stages:
                continue
            if q.register is not None and e.register is not q.register:
                continue
            if q.starred is not None and e.star != q.starred:
                continue
            encounters = list(state.encounters.get(e.id, ()))
            if source_id and e.source_id != source_id and all(x.source_id != source_id for x in encounters):
                continue
            captured = sch.business_day(datetime.fromisoformat(e.created_at.replace("Z", "+00:00"))) \
                if e.created_at else None
            if q.captured_from and (captured is None or captured < q.captured_from):
                continue
            if q.captured_to and (captured is None or captured > q.captured_to):
                continue
            links = [lk for lk in state.links.get(e.id, ()) if lk.status in usable]
            linked = {lk.tag_id for lk in links}
            if situations and not situations & linked:
                continue
            if feelings and not feelings & linked:
                continue
            values = search_fields(e, state.tags_of(e.id), encounters, extra=extra)
            count, best = match_fields({k: v for k, v in values.items() if k in fields}, patterns)
            if not count:
                continue
            wanted = situations | feelings
            confirmed = sum(1 for lk in links if lk.status is m.TagStatus.CONFIRMED
                            and (not wanted or lk.tag_id in wanted))
            hits.append(((-count, best.rank, -confirmed, not e.star, _desc(e.created_at), e.id),
                         {"id": e.id, "text": e.text, "field": best.field, "snippet": best.snippet}))
        hits.sort(key=lambda h: h[0])
        return {"hits": [h for _, h in hits[:q.limit]], "total": len(hits)}

    async def get_words(self, user: str, ids: list[str]) -> dict:
        if not 1 <= len(ids) <= MAX_GET:
            raise WordsError(f"ids は1〜{MAX_GET}個にしてください")
        state = await self.repo.state(user)
        found = [state.expressions[i] for i in dict.fromkeys(ids) if i in state.expressions]
        return {"words": [full_view(state, e, self.today()) for e in found],
                "not_found": [i for i in dict.fromkeys(ids) if i not in state.expressions]}

    async def reflection_material(self, user: str, days: int) -> dict:
        if not 7 <= days <= 90:
            raise WordsError("days は7〜90にしてください")
        state = await self.repo.state(user)
        today = self.today()
        start = today - timedelta(days=days - 1)

        def day_of(moment: str) -> date:
            return sch.business_day(datetime.fromisoformat(moment.replace("Z", "+00:00")))

        hand = sorted(state.hand(), key=lambda e: (-sch.priority(e, today), e.id))
        captured, reencountered = [], []
        for e in state.expressions.values():
            created = day_of(e.created_at) if e.created_at else None
            if created and created >= start:
                captured.append(e)
            elif any(day_of(x.created_at) >= start for x in state.encounters.get(e.id, ()) if x.created_at):
                reencountered.append(e)
        results = {"said": 0, "close": 0, "blank": 0, "use": 0}
        for reviews in state.reviews.values():
            for r in reviews:
                if day_of(r.reviewed_at) < start:
                    continue
                if r.kind is m.ReviewKind.USE:
                    results["use"] += 1
                elif r.result is not None:  # 結果のない振り返り（アプリが項目ごとに送る途中など）は数えない
                    results[r.result.value] += 1
        to_hand = [e for e in state.expressions.values() if e.place is m.Place.COLLECTED
                   and (len(state.encounters.get(e.id, ())) >= 2 or e.star)]
        demote = [e for e in hand if sch.should_suggest_demote(e, today)]
        own = [e for e in hand if sch.own_ready(self.use_days(state, e.id))]

        def newest(items):
            return sorted(items, key=lambda e: (_desc(e.created_at), e.id))[:MAX_MATERIAL_ITEMS]

        return {
            "from": start.isoformat(), "to": today.isoformat(), "days": days,
            "hand": [hand_view(state, e, today) for e in hand],
            "hand_count": self._hand_count(state),
            "review_queue": [{"id": i.expression.id, "text": i.expression.text, "priority": i.priority, "due": i.due}
                             for i in sch.review_queue(hand, today)],
            "captured": [brief(e) for e in newest(captured)], "captured_total": len(captured),
            "reencountered": [{**brief(e), "encounter_count": len(state.encounters.get(e.id, ()))}
                              for e in newest(reencountered)],
            "review_results": results,
            "suggest_to_hand": [{**brief(e), "encounter_count": len(state.encounters.get(e.id, ())), "star": e.star}
                                for e in newest(to_hand)],
            "suggest_demote": [{**brief(e), "lapse_streak": e.schedule.lapse_streak,
                                "hand_since": _iso(e.hand_since)} for e in demote],
            "suggest_own": [{**brief(e), "use_count": e.schedule.use_count} for e in own],
        }


def _desc(text: str | None) -> str:
    """新しい順に並べるためのキー（文字の順を逆にする）。"""
    return "".join(chr(0x10FFFF - ord(c)) for c in (text or ""))


# --- 出力の形 ---


def brief(e: m.Expression) -> dict:
    return {"id": e.id, "text": e.text, "place": e.place.value, "stage": e.schedule.stage.value if e.schedule.stage else None}


def source_view(s: m.Source) -> dict:
    return {"id": s.id, "name": s.name, "icon_key": s.icon_key, **({"hidden": True} if s.hidden else {})}


def tag_views(state: WordsState, expression_id: str) -> list[dict]:
    out = []
    for link in state.links.get(expression_id, ()):
        tag = state.tag(link.tag_id)
        if tag is not None:
            out.append({"name": tag.name, "kind": tag.kind.value, "added_by": link.added_by.value,
                        "status": link.status.value})
    return sorted(out, key=lambda t: (t["kind"] != "situation", t["status"] != "confirmed", t["name"]))


def hand_view(state: WordsState, e: m.Expression, today: date) -> dict:
    s = e.schedule
    return {**brief(e), "interval_days": s.interval_days, "due_on": _iso(s.due_on), "due": sch.is_due(e, today),
            "success_streak": s.success_streak, "lapse_streak": s.lapse_streak, "use_count": s.use_count,
            "usefulness": e.usefulness, "usefulness_until": _iso(e.usefulness_until), "star": e.star,
            "hand_since": _iso(e.hand_since), "scene": e.scene}


def full_view(state: WordsState, e: m.Expression, today: date | None = None) -> dict:
    s = e.schedule
    source = state.source(e.source_id)
    encounters = newest_encounters(list(state.encounters.get(e.id, ())), GET_ENCOUNTERS)
    reviews = list(state.reviews.get(e.id, ()))[-GET_REVIEWS:][::-1]
    return {
        **brief(e), "reading": e.reading, "meaning": e.meaning, "nuance": e.nuance,
        "register": e.register.value if e.register else None,
        "register_by": e.register_by.value if e.register_by else None,
        "examples": list(e.examples), "similar": list(e.similar), "use_note": e.use_note, "scene": e.scene,
        "note": e.note, "star": e.star, "source": source.name if source else None,
        "usefulness": e.usefulness, "usefulness_reason": e.usefulness_reason,
        "usefulness_until": _iso(e.usefulness_until),
        "schedule": {"interval_days": s.interval_days, "due_on": _iso(s.due_on),
                     "last_reviewed_on": _iso(s.last_reviewed_on), "success_streak": s.success_streak,
                     "lapse_streak": s.lapse_streak, "review_count": s.review_count, "use_count": s.use_count,
                     "last_used_on": _iso(s.last_used_on)},
        "tags": tag_views(state, e.id),
        "encounters": [{"id": x.id, "source": (src.name if (src := state.source(x.source_id)) else None),
                        "title": x.title, "locator": x.locator, "met_on": _iso(x.met_on), "time_hint": x.time_hint,
                        "scene": x.scene, "surrounding_text": x.surrounding_text, "wording": x.wording,
                        "captured_via": x.captured_via, "note": x.note, "created_at": jst(x.created_at)}
                       for x in encounters],
        "encounter_count": len(state.encounters.get(e.id, ())),
        "recent_reviews": [{"kind": r.kind.value, "result": r.result.value if r.result else None,
                            "reviewed_at": jst(r.reviewed_at),
                            "interval_after": r.interval_after} for r in reviews],
        "captured_at": jst(e.created_at), "enriched_at": jst(e.enriched_at),
    }

