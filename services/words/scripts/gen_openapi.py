"""ことばのアプリ用の API の仕様（docs/api/words-app-api.yaml）を作る。

同期の封筒（送信・受け取り・スナップショット・エラー）は KARADA の docs/api/app-api.yaml から写し、scope を training だけにする。
種類ごとの項目（*Fields）は、サーバーの登録（words/infrastructure/sync_entities.py の pydantic のモデル）から作る。
サーバーの決まりを変えたら、これを流し直す（tests/test_openapi.py が、今のファイルと同じかを確かめる）。

  uv run python scripts/gen_openapi.py
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from words.infrastructure import sync_entities as se  # noqa: E402

SOURCE = ROOT / "docs" / "api" / "app-api.yaml"
TARGET = ROOT / "docs" / "api" / "words-app-api.yaml"

MODELS = {
    se.SOURCE: ("SourceFields", se.SourceFields, "出会った場所。アプリからは create・update・restore だけ（消すのは hidden）"),
    se.EXPRESSION: ("ExpressionFields", se.ExpressionFields,
                    "表現。補う項目（meaning・nuance・similar・usefulness・usefulness_reason・usefulness_until・enriched_at）は"
                    "アプリから書けない。間隔の項目（stage・interval_days・due_on・listened_at・listen_count・use_count・last_used_on）は"
                    "組で送る。例文（examples）は本人と Claude の両方が書く一覧（一覧ごと置き換わる）"),
    se.TAG: ("TagFields", se.TagFields, "使う場面・気持ちのタグ。アプリからは create・update・restore だけ（消すのは hidden）"),
    se.EXPRESSION_TAG: ("ExpressionTagFields", se.ExpressionTagFields,
                        "表現とタグのつながり。entity_id は uuid5(ことばの名前空間, \"<expression_id>:<tag_id>\")"
                        "（testdata/words/catalog.json）。added_by・status・confirmed_at は組で送る。表現と一緒に消す"),
    se.ENCOUNTER: ("EncounterFields", se.EncounterFields, "出会い1回。表現と一緒に消す"),
    se.USAGE: ("UsageFields", se.UsageFields, "実際の会話で使えた1回。追記だけ（create・delete）。表現と一緒に消す"),
    se.LISTEN_SESSION: ("ListenSessionFields", se.ListenSessionFields,
                        "アプリで聞いた1回（続けて流したまとまり）。追記だけ（create・delete）。活動の記録に使う"),
}
ENVELOPE = ["PushRequest", "PushResult", "ChangeError", "PushResponse", "EntityState", "ChangeRecord", "ChangesPage",
            "SnapshotPage", "FieldError", "Problem", "GatewayError"]


def camel(entity_type: str) -> str:
    return "".join(part.capitalize() for part in entity_type.split("_"))


def _strip_titles(node):
    if isinstance(node, dict):
        node.pop("title", None)
        for value in node.values():
            _strip_titles(value)
    elif isinstance(node, list):
        for value in node:
            _strip_titles(value)


def _defs_to_components(node):
    if isinstance(node, dict):
        if isinstance(node.get("$ref"), str):
            node["$ref"] = node["$ref"].replace("#/$defs/", "#/components/schemas/")
        for value in node.values():
            _defs_to_components(value)
    elif isinstance(node, list):
        for value in node:
            _defs_to_components(value)


def fields_schema(model, description: str, entity_type: str, shared: dict) -> dict:
    schema = model.model_json_schema()
    for name, sub in schema.pop("$defs", {}).items():  # 入れ子の型（例文 ExampleFields）は components に出す
        _strip_titles(sub)
        sub["additionalProperties"] = False
        shared[name] = sub
    _defs_to_components(schema)
    schema.pop("title", None)
    for prop in schema.get("properties", {}).values():
        prop.pop("title", None)
        prop.pop("default", None)  # 既定の None は「送らない」の意味（サーバーは送られた項目だけを当てはめる）
        for option in prop.get("anyOf", []):
            option.pop("title", None)
            if isinstance(option.get("items"), dict):
                option["items"].pop("title", None)
        if isinstance(prop.get("items"), dict):
            prop["items"].pop("title", None)
    schema["additionalProperties"] = False
    schema["description"] = f"{description}。create で要る項目：{'・'.join(se.REQUIRED[entity_type])}"
    return schema


def change_schema(template: dict, entity_type: str, spec) -> dict:
    out = copy.deepcopy(template)
    props = out["properties"]
    props["entity_type"] = {"type": "string", "const": entity_type}
    props["entity_id"]["description"] = "対象の ID（UUID）"
    props["parent_id"] = {"type": "null", "description": "ことばの種類は親と一緒に保存しない（子は expression_id で指す）。null か省く"}
    props["op"] = {"type": "string", "enum": list(spec.app_ops),
                   "description": f"アプリから送れる op：{'・'.join(spec.app_ops)}"}
    props["fields"] = {"$ref": f"#/components/schemas/{MODELS[entity_type][0]}",
                       "description": "create・update の項目。delete・restore には入れない"}
    return out


def build() -> dict:
    base = yaml.safe_load(SOURCE.read_text())
    paths = {p: copy.deepcopy(base["paths"][p]) for p in ("/v1/sync/changes", "/v1/sync/snapshot")}
    for item in paths.values():
        for operation in item.values():
            scopes = {s for req in operation.get("security", []) for s in req.get("cognito", [])}
            action = "write" if any(s.endswith(".write") for s in scopes) else "read"
            operation["security"] = [{"cognito": [f"torelog-api/training.{action}"]}]
    paths["/v1/audio"] = {"post": {
        "operationId": "synthesizeAudio",
        "summary": "「聞く」の読み上げ（MP3。設定の「自然な声」のときだけ）",
        "description": (
            "表現の項目から決まった型の台本（表現 → 読み → 説明（意味とニュアンス）→ 使い方 → 例文1〜2個。区切りは SSML の間）を作り、"
            "Amazon Polly（ja-JP、neural）で読んだ MP3 を返す。音声はサーバーにもアプリにも置かない（毎回作る。cache-control: no-store）。"
            "既定のアプリは端末の読み上げ（Android の TTS）で同じ型の台本を読み、この API は呼ばない。"),
        "security": [{"cognito": ["torelog-api/training.read"]}],
        "requestBody": {"required": True, "content": {"application/json": {"schema": {
            "type": "object", "additionalProperties": False, "required": ["expression_id"],
            "properties": {"expression_id": {"type": "string", "format": "uuid"},
                           "voice": {"type": "string", "enum": ["Kazuha", "Takumi", "Tomoko"], "default": "Kazuha"}}}}}},
        "responses": {
            "200": {"description": "MP3（24kHz）",
                    "content": {"audio/mpeg": {"schema": {"type": "string", "format": "binary"}}}},
            "400": {"description": "本文の形が違う",
                    "content": {"application/problem+json": {"schema": {"$ref": "#/components/schemas/Problem"}}}},
            "404": {"description": "表現がない（消した・まだ同期していない）",
                    "content": {"application/problem+json": {"schema": {"$ref": "#/components/schemas/Problem"}}}},
            "401": {"$ref": "#/components/responses/Unauthorized"},
            "403": {"$ref": "#/components/responses/Forbidden"},
            "429": {"$ref": "#/components/responses/TooManyRequests"},
            "500": {"$ref": "#/components/responses/InternalError"},
        },
    }}
    components = copy.deepcopy(base["components"])
    components["securitySchemes"]["cognito"]["flows"]["authorizationCode"]["scopes"] = {
        "openid": "OIDC", "torelog-api/training.read": "ことばの記録を読む（KARADA の筋トレと同じ scope）",
        "torelog-api/training.write": "ことばの記録を書く（同上）"}
    schemas = {"EntityType": {"type": "string", "enum": list(se.ENTITY_TYPES),
                              "description": "対象の種類。どれも torelog-api/training.* の scope で扱う"}}
    registry = se.create_registry()
    template = base["components"]["schemas"]["ReportChange"]
    for entity_type, (name, model, description) in MODELS.items():
        schemas[name] = fields_schema(model, description, entity_type, schemas)
    for entity_type in MODELS:
        schemas[f"{camel(entity_type)}Change"] = change_schema(template, entity_type, registry.specs[entity_type])
    schemas["Change"] = {
        "oneOf": [{"$ref": f"#/components/schemas/{camel(t)}Change"} for t in MODELS],
        "discriminator": {"propertyName": "entity_type",
                          "mapping": {t: f"#/components/schemas/{camel(t)}Change" for t in MODELS}},
    }
    for name in ENVELOPE:
        schemas[name] = base["components"]["schemas"][name]
    components["schemas"] = schemas
    return {
        "openapi": base["openapi"],
        "info": {
            "title": "ことば アプリ用 API",
            "version": "0.1.0",
            "description": (
                "スマホアプリ（ことば、apps/words）の同期の API。設計は docs/words-design.md の「同期」。\n\n"
                "- 形は KARADA のアプリ用 API（docs/api/app-api.yaml）の同期と同じ。テーブルと変更の番号は KARADA と別（WordsTable）\n"
                "- 認可：KARADA と同じ Cognito のアプリ用クライアント（torelog-app）のアクセストークン。scope は torelog-api/training.*\n"
                "- 利用者はトークンの sub で決まる。本文や URL に利用者の ID は入れない\n"
                "- 時刻は UTC の RFC 3339（ミリ秒まで）。日付は日本時間（午前4時で区切る）\n"
                "- 流量の制限：1秒2回・瞬間10回。超えると 429\n"
                "- 初期の行（出会った場所5つ・タグ20個）は固定の ID（testdata/words/catalog.json）。変えるまで送らず、変えた項目だけを update で送る"),
        },
        "servers": [{"url": "https://{apiId}.execute-api.ap-northeast-1.amazonaws.com",
                     "description": "cdk deploy の出力 WordsAppApiUrl（SSM /cognito-study/words/app/api-url）",
                     "variables": {"apiId": {"default": "xxxxxxxxxx"}}}],
        "security": [],
        "paths": paths,
        "components": components,
    }


def render() -> str:
    header = ("# ことば アプリ用 API（同期）。設計は docs/words-design.md。\n"
              "# services/words/scripts/gen_openapi.py で作る（直接は直さない）。\n")
    return header + yaml.safe_dump(build(), allow_unicode=True, sort_keys=False, width=120)


if __name__ == "__main__":
    TARGET.write_text(render())
    print(f"{TARGET} を作りました")
