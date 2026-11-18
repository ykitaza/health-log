"""ことばのアプリ用の API の組み立て。Lambda のハンドラーは handler（cdk/lib/words-stack.ts の WordsAppApiFunction）。

- 同期：同期の入口（sync の SyncHttpApi）をそのまま使い、ことばの種類だけを登録した Registry と WordsTable で動かす。
  ルートは KARADA と同じ形（POST・GET /v1/sync/changes、GET /v1/sync/snapshot）
- 読み上げ（POST /v1/audio）：設定の「自然な声」（既定はオフ）のときだけアプリが呼ぶ。表現の項目から決まった型の台本（SSML）を作り、
  Amazon Polly（ja-JP の neural）で MP3 にして返す。音声はどこにも置かない（サーバーにもアプリにもキャッシュしない。毎回作る）。
  既定のアプリは、端末の読み上げ（Android の TTS）で同じ型の台本を読むので、この API を呼ばない
仕様は docs/api/words-app-api.yaml。ログインは KARADA と共通：クライアントは torelog-app、scope は torelog-api/training.read・training.write。
Lambda Web Adapter は通さず、API Gateway のイベントを直接受け取る（オーソライザーが確かめたクレームを読むため）。
"""

import base64
import logging
import os
from datetime import datetime
from typing import Callable

import anyio

from sync.engine import SyncEngine
from sync.presentation.http_api import HttpError, SyncHttpApi, _problem, parse_body
from sync.registry import UUID_PATTERN
from words.application.service import WordsService
from words.domain.errors import WordsError
from words.domain.schedule import JST
from words.domain.speech import DEFAULT_VOICE, ENGINE, VOICES
from words.main import create_engine, create_service

logging.getLogger().setLevel(logging.INFO)
logger = logging.getLogger("words.audio")

AUDIO_PATH = "/v1/audio"
MAX_AUDIO_BODY = 1024
# 音声（base64）は Lambda の応答の上限（6MB）より十分小さい：台本は 1,000 文字ほどまでで、MP3（24kHz）は1分あたり 400KB ほど
MAX_AUDIO_BYTES = 4 * 1024 * 1024

# (台本の SSML, 声, エンジン) → MP3 のバイト列
Synthesizer = Callable[[str, str, str], bytes]


def polly_synthesizer() -> Synthesizer:
    clients: list = []

    def synthesize(ssml: str, voice: str, engine: str) -> bytes:
        if not clients:  # 初めて使うときに作る
            import boto3  # Lambda の実行環境に入っている

            clients.append(boto3.client("polly"))
        res = clients[0].synthesize_speech(Engine=engine, LanguageCode="ja-JP", OutputFormat="mp3", SampleRate="24000",
                                       Text=ssml, TextType="ssml", VoiceId=voice)
        return res["AudioStream"].read()

    return synthesize


class AudioApi:
    """POST /v1/audio：{"expression_id": "...", "voice": "Kazuha"}（voice は省ける）。"""

    def __init__(self, sync_api: SyncHttpApi, service: WordsService, synthesize: Synthesizer):
        self.sync_api, self.service, self.synthesize = sync_api, service, synthesize

    def handle(self, event: dict) -> dict:
        try:
            caller = self.sync_api._caller(event)  # 同期と同じ確かめ方（torelog-app のアクセストークン）
            if not caller.can("training", "read"):
                raise HttpError(403, "forbidden", "読む scope（torelog-api/training.read）がありません")
            body = parse_body(event, MAX_AUDIO_BODY)
            if not isinstance(body, dict) or set(body) - {"expression_id", "voice"}:
                raise HttpError(400, "invalid-request", "本文は expression_id と voice だけにしてください")
            expression_id, voice = body.get("expression_id"), body.get("voice", DEFAULT_VOICE)
            if not isinstance(expression_id, str) or not UUID_PATTERN.match(expression_id):
                raise HttpError(400, "invalid-request", "expression_id は UUID にしてください",
                                [{"field": "expression_id", "message": "UUID"}])
            if voice not in VOICES:
                raise HttpError(400, "invalid-request", f"voice は {'・'.join(VOICES)} のどれかにしてください",
                                [{"field": "voice", "message": "・".join(VOICES)}])
            try:
                script = anyio.run(self.service.speech_script, caller.user, expression_id)
            except WordsError as e:
                raise HttpError(404, "not-found", str(e)) from e
            audio = self.synthesize(script.ssml, voice, ENGINE)
            if len(audio) > MAX_AUDIO_BYTES:
                raise HttpError(500, "internal", "音声が大きすぎます")
            # 利用者と中身は出さない（文字数だけ。費用の見積もりに使う）
            logger.info("speech chars=%d bytes=%d voice=%s", len(script.text), len(audio), voice)
            return {"statusCode": 200, "headers": {"content-type": "audio/mpeg", "cache-control": "no-store"},
                    "body": base64.b64encode(audio).decode(), "isBase64Encoded": True}
        except HttpError as e:
            return _problem(e)
        except Exception:
            logger.exception("audio failed")
            return _problem(HttpError(500, "internal", "サーバーの不具合です。少し待って送り直してください"))


class WordsAppApi:
    def __init__(self, sync_api: SyncHttpApi, audio: AudioApi):
        self.sync_api, self.audio = sync_api, audio

    def handle(self, event: dict) -> dict:
        method = ((event.get("requestContext") or {}).get("http") or {}).get("method")
        if (method, event.get("rawPath")) == ("POST", AUDIO_PATH):
            return self.audio.handle(event)
        return self.sync_api.handle(event)


def now() -> datetime:
    return datetime.now(JST)


def create_api(engine: SyncEngine, app_client_id: str, synthesize: Synthesizer | None = None) -> WordsAppApi:
    sync_api = SyncHttpApi(engine, engine.registry, app_client_id)
    service = create_service(engine, now)
    return WordsAppApi(sync_api, AudioApi(sync_api, service, synthesize or polly_synthesizer()))


_api: WordsAppApi | None = None


def handler(event: dict, context) -> dict:
    global _api
    if _api is None:  # 最初の呼び出しで作る（テストで環境変数なしに import できるように）
        _api = create_api(create_engine(os.environ["WORDS_TABLE"]), os.environ["APP_CLIENT_ID"])
    return _api.handle(event)
