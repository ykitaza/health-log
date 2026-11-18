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
                    "表現。補う項目（meaning・nuance・examples・similar・usefulness・usefulness_reason・usefulness_until・enriched_at）は"
                    "アプリから書けない。間隔の項目（stage〜last_used_on）は組で送る"),
    se.TAG: ("TagFields", se.TagFields, "使う場面・気持ちのタグ。アプリからは create・update・restore だけ（消すのは hidden）"),
    se.EXPRESSION_TAG: ("ExpressionTagFields", se.ExpressionTagFields,
                        "表現とタグのつながり。entity_id は uuid5(ことばの名前空間, \"<expression_id>:<tag_id>\")"
                        "（testdata/words/catalog.json）。added_by・status・confirmed_at は組で送る。表現と一緒に消す"),
    se.ENCOUNTER: ("EncounterFields", se.EncounterFields, "出会い1回。表現と一緒に消す"),
    se.REVIEW: ("ReviewFields", se.ReviewFields, "振り返りの記録（と使えたの報告）。追記だけ（create・delete）。表現と一緒に消す"),
}
ENVELOPE = ["PushRequest", "PushResult", "ChangeError", "PushResponse", "EntityState", "ChangeRecord", "ChangesPage",
            "SnapshotPage", "FieldError", "Problem", "GatewayError"]


def camel(entity_type: str) -> str:
    return "".join(part.capitalize() for part in entity_type.split("_"))


def fields_schema(model, description: str, entity_type: str) -> dict:
    schema = model.model_json_schema()
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
    components = copy.deepcopy(base["components"])
    components["securitySchemes"]["cognito"]["flows"]["authorizationCode"]["scopes"] = {
        "openid": "OIDC", "torelog-api/training.read": "ことばの記録を読む（KARADA の筋トレと同じ scope）",
        "torelog-api/training.write": "ことばの記録を書く（同上）"}
    schemas = {"EntityType": {"type": "string", "enum": list(se.ENTITY_TYPES),
                              "description": "対象の種類。どれも torelog-api/training.* の scope で扱う"}}
    registry = se.create_registry()
    template = base["components"]["schemas"]["ReportChange"]
    for entity_type, (name, model, description) in MODELS.items():
        schemas[name] = fields_schema(model, description, entity_type)
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
