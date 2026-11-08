"""アプリ用の API の入口（同期の送信・受け取り・スナップショット）。仕様は docs/api/app-api.yaml。

API Gateway（HTTP API、形式 2.0）のイベントを受け取り、応答を返す。
利用者は、JWT のオーソライザーが確かめたクレーム（requestContext.authorizer.jwt.claims）の sub だけで決める。
本文や URL に利用者の ID は入れない。クレームはオーソライザーが書くもので、利用者が送るヘッダーからは読まない。
同期でないルート（例：食事の目標の案）は、各コンテキストの presentation が routes で足す。
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
from dataclasses import dataclass
from typing import Callable, Literal

from pydantic import ValidationError

from sync.engine import SyncEngine
from sync.registry import UUID_PATTERN, Registry, Rejection
from sync.store import STATE_PREFIX

logger = logging.getLogger("sync.http_api")

SCOPE_PREFIX = "torelog-api/"
MAX_PUSH = 25
PROBLEM_BASE = "https://torelog.invalid/problems/"


@dataclass(frozen=True)
class Caller:
    user: str
    scopes: frozenset[str]  # 「meals.read」など（torelog-api/ を外したもの）

    def can(self, area: str, action: Literal["read", "write"]) -> bool:
        return f"{area}.{action}" in self.scopes

    def areas(self, action: Literal["read", "write"]) -> set[str]:
        return {s.removesuffix(f".{action}") for s in self.scopes if s.endswith(f".{action}")}


class HttpError(Exception):
    def __init__(self, status: int, slug: str, title: str, errors: list[dict] | None = None):
        super().__init__(title)
        self.status, self.slug, self.title, self.errors = status, slug, title, errors or []


Route = Callable[[Caller, dict], dict]


class SyncHttpApi:
    def __init__(self, engine: SyncEngine, registry: Registry, app_client_id: str,
                 routes: dict[tuple[str, str], Route] | None = None):
        self.engine, self.registry, self.app_client_id = engine, registry, app_client_id
        self.routes: dict[tuple[str, str], Route] = {
            ("POST", "/v1/sync/changes"): self.push,
            ("GET", "/v1/sync/changes"): self.pull,
            ("GET", "/v1/sync/snapshot"): self.snapshot,
        }
        for key, route in (routes or {}).items():
            if key in self.routes:
                raise ValueError(f"{key} はすでにあります")
            self.routes[key] = route

    def handle(self, event: dict) -> dict:
        http = (event.get("requestContext") or {}).get("http") or {}
        route = self.routes.get((http.get("method"), event.get("rawPath")))
        try:
            if route is None:
                raise HttpError(404, "not-found", "このパスはありません")
            caller = self._caller(event)
            return _json(200, route(caller, event))
        except HttpError as e:
            return _problem(e)
        except Exception:
            logger.exception("app api failed")  # 中身（本文）はログに出さない
            return _problem(HttpError(500, "internal", "サーバーの不具合です。少し待って送り直してください"))

    def _caller(self, event: dict) -> Caller:
        """オーソライザーが確かめたクレームから利用者を決める。ないとき（設定の誤り）は断る。"""
        claims = ((event.get("requestContext") or {}).get("authorizer") or {}).get("jwt", {}).get("claims") or {}
        sub = claims.get("sub")
        # オーソライザーでも確かめているが、アプリのクライアントのアクセストークンだけを、ここでも確かめる
        if not sub or claims.get("token_use") != "access" or claims.get("client_id") != self.app_client_id:
            raise HttpError(401, "unauthorized", "アクセストークンがありません")
        scopes = frozenset(s.removeprefix(SCOPE_PREFIX) for s in str(claims.get("scope", "")).split()
                           if s.startswith(SCOPE_PREFIX))
        return Caller(sub, scopes)

    def _types(self, caller: Caller, action: Literal["read", "write"]) -> set[str]:
        return self.registry.types_in(caller.areas(action))

    # --- 同期 ---

    def push(self, caller: Caller, event: dict) -> dict:
        body = parse_body(event)
        if not isinstance(body, dict) or set(body) - {"device_id", "changes"}:
            raise HttpError(400, "invalid-request", "本文は device_id と changes だけにしてください")
        device_id, raw_changes = body.get("device_id"), body.get("changes")
        if not isinstance(device_id, str) or not 1 <= len(device_id) <= 64:
            raise HttpError(400, "invalid-request", "device_id は1〜64文字にしてください",
                            [{"field": "device_id", "message": "1〜64文字"}])
        if not isinstance(raw_changes, list) or not 1 <= len(raw_changes) <= MAX_PUSH:
            raise HttpError(400, "invalid-request", f"changes は1〜{MAX_PUSH}件にしてください",
                            [{"field": "changes", "message": f"1〜{MAX_PUSH}件"}])
        ids = []
        for n, raw in enumerate(raw_changes):
            change_id = raw.get("change_id") if isinstance(raw, dict) else None
            if not isinstance(change_id, str) or not UUID_PATTERN.match(change_id):
                raise HttpError(400, "invalid-request", "change_id は UUID にしてください",
                                [{"field": f"changes[{n}].change_id", "message": "UUID"}])
            ids.append(change_id.lower())
        if len(set(ids)) != len(ids):
            raise HttpError(400, "invalid-request", "同じ change_id が2回あります")

        writable = self._types(caller, "write")
        parsed = [self.registry.parse_change(raw, writable, device_id) for raw in raw_changes]
        accepted = {a.change_id: a for a in self.engine.append(
            caller.user, [c for c in parsed if not isinstance(c, Rejection)])}
        results = []
        for n, (change_id, result) in enumerate(zip(ids, parsed)):
            if isinstance(result, Rejection):
                errors = [{**e, "field": f"changes[{n}].{e['field']}"} for e in result.errors]
                results.append({"change_id": change_id, "status": "rejected", "seq": None,
                                "error": {**result.view(), "errors": errors}})
            else:
                a = accepted[change_id]
                results.append({"change_id": change_id, "status": "duplicate" if a.duplicate else "accepted",
                                "seq": a.seq, "error": None})
        return {"results": results, "cursor": self.engine.head(caller.user)}

    def pull(self, caller: Caller, event: dict) -> dict:
        query = event.get("queryStringParameters") or {}
        after = _int(query, "after", 0, 0, None)
        limit = _int(query, "limit", 100, 1, 500)
        entries, next_cursor, more = self.engine.pull(caller.user, after, limit, self._types(caller, "read"))
        return {"entries": [e.to_json() for e in entries], "next_cursor": next_cursor, "has_more": more}

    def snapshot(self, caller: Caller, event: dict) -> dict:
        query = event.get("queryStringParameters") or {}
        limit = _int(query, "limit", 200, 1, 500)
        token = query.get("page_token")
        start_after = _decode_page_token(token) if token else None
        # 最初のページで今の seq を読む。スナップショットの途中の変更は、このあと changes で届く
        cursor = self.engine.head(caller.user)
        states, last = self.engine.snapshot(caller.user, start_after, limit, self._types(caller, "read"))
        return {"states": states, "cursor": cursor, "next_page_token": _encode_page_token(last) if last else None}


def parse_body(event: dict):
    """本文の JSON（NaN・Infinity は断る）。"""
    raw = event.get("body") or ""
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode()
        return json.loads(raw, parse_constant=_reject_constant)
    except (ValueError, binascii.Error, UnicodeDecodeError) as e:
        raise HttpError(400, "invalid-request", "本文が JSON ではありません") from e


def field_errors(e: ValidationError) -> list[dict]:
    return [{"field": ".".join(map(str, err["loc"])), "message": err["msg"]} for err in e.errors()]


def _reject_constant(name: str):
    raise ValueError(f"{name} は使えません")


def _int(query: dict, name: str, default: int, low: int, high: int | None) -> int:
    if name not in query:
        return default
    text = query[name]
    if not text.isdigit() or int(text) < low or (high is not None and int(text) > high):
        bound = f"{low}〜{high}" if high is not None else f"{low}以上"
        raise HttpError(400, "invalid-request", f"{name} は {bound} の整数にしてください",
                        [{"field": name, "message": bound}])
    return int(text)


def _encode_page_token(sk: str) -> str:
    return base64.urlsafe_b64encode(json.dumps({"after": sk}).encode()).decode()


def _decode_page_token(token: str) -> str:
    """どの利用者の pk で読むかはクレームで決まるので、トークンには sk の位置しか入れない。"""
    try:
        after = json.loads(base64.urlsafe_b64decode(token.encode()))["after"]
    except (ValueError, KeyError, TypeError, binascii.Error) as e:
        raise HttpError(400, "invalid-request", "page_token が壊れています") from e
    if not isinstance(after, str) or not after.startswith(STATE_PREFIX):
        raise HttpError(400, "invalid-request", "page_token が壊れています")
    return after


def _json(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": {"content-type": "application/json"},
            "body": json.dumps(body, ensure_ascii=False)}


def _problem(e: HttpError) -> dict:
    body = {"type": PROBLEM_BASE + e.slug, "title": e.title, "status": e.status}
    if e.errors:
        body["errors"] = e.errors
    return {"statusCode": e.status, "headers": {"content-type": "application/problem+json"},
            "body": json.dumps(body, ensure_ascii=False)}
