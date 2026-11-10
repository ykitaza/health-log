"""一度だけ動かす：体組成の筋肉率（muscle_pct）とウエスト（waist_cm）を、サーバーの同期の記録から消す（アプリの版11と組で使う）。

対象は MealsTable の同期の項目（services/sync/sync/store.py）：
  SYNC#STATE#body_record#<ID>  今の状態。own の values と keys から2つの項目を除く
  SYNC#LOG#<seq>               変更の記録。体組成の変更の fields と、当てはめたあとの状態（state の fields）から除く
seq や時刻は変えない（アプリの受け取りの位置を動かさない）。

既定は数えるだけ（読む操作の Scan だけ）。--apply を付けたときだけ書き換える。書き換えは1件ずつで、読んだときから
変わっていない項目だけを書く（同期と重なったものは飛ばし、もう一度動かせばよい）。値そのものは出さず、件数と日付の範囲だけを出す。

  eval "$(aws configure export-credentials --profile yuki --format env)"
  uv run --with boto3 python scripts/drop_waist_muscle.py --table <MealsTable の名前>            # 数える
  uv run --with boto3 python scripts/drop_waist_muscle.py --table <MealsTable の名前> --apply    # 消す
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field

DROPPED = ("muscle_pct", "waist_cm")
STATE_PREFIX = "SYNC#STATE#body_record#"
LOG_PREFIX = "SYNC#LOG#"


def _strip(values: dict) -> dict:
    return {k: v for k, v in values.items() if k not in DROPPED}


def _has_value(values: dict | None, name: str) -> bool:
    return bool(values) and values.get(name) is not None


def scrub_state(doc: dict) -> dict | None:
    """今の状態（Doc の JSON）から2つの項目を除いたもの。除くものがなければ None。"""
    own = doc.get("own")
    if not own or not any(k in own["values"] or k in own["keys"] for k in DROPPED):
        return None
    return {**doc, "own": {**own, "values": _strip(own["values"]), "keys": _strip(own["keys"])}}


def scrub_log(entry: dict) -> dict | None:
    """変更の記録（LogEntry の JSON）から2つの項目を除いたもの。体組成でないか、除くものがなければ None。"""
    change, state = entry["change"], entry["state"]
    if change["entity_type"] != "body_record":
        return None
    fields, state_fields = change.get("fields") or {}, state.get("fields") or {}
    if not any(k in fields or k in state_fields for k in DROPPED):
        return None
    return {"change": {**change, "fields": None if change.get("fields") is None else _strip(fields)},
            "state": {**state, "fields": _strip(state_fields)}}


@dataclass
class Summary:
    users: set = field(default_factory=set)  # pk（出さない。人数だけ）
    records: dict = field(default_factory=lambda: {k: 0 for k in DROPPED})  # 値がある今の記録の数（消した記録も含む）
    deleted_records: int = 0  # そのうち、消した記録
    days: set = field(default_factory=set)  # どちらかに値がある記録の日付
    empty_after: int = 0  # 2つを除くと値もメモもなくなる、消していない手入力の記録（アプリの版11が消す）
    log_changes: dict = field(default_factory=lambda: {k: 0 for k in DROPPED})  # 値がある変更（change の fields）
    log_states: int = 0  # 当てはめたあとの状態にどちらかの値が残っている変更の記録
    to_rewrite: int = 0  # 書き換える項目（今の状態＋変更の記録）
    rewritten: int = 0
    skipped: int = 0  # 読んだあとに変わっていて、書かなかったもの

    def lines(self) -> list[str]:
        days = sorted(self.days)
        return [
            f"利用者: {len(self.users)}",
            f"今の記録: 筋肉率あり {self.records['muscle_pct']}、ウエストあり {self.records['waist_cm']}"
            f"（うち消した記録 {self.deleted_records}）",
            f"どちらかがある日: {len(days)}" + (f"（{days[0]} 〜 {days[-1]}）" if days else ""),
            f"除くと空になる手入力の記録（アプリの版11が消す）: {self.empty_after}",
            f"変更の記録: 筋肉率の値あり {self.log_changes['muscle_pct']}、ウエストの値あり {self.log_changes['waist_cm']}、"
            f"当てはめたあとの状態に値が残る {self.log_states}",
            f"書き換える項目: {self.to_rewrite}（書いた {self.rewritten}、変わっていて飛ばした {self.skipped}）",
        ]


def _count_state(summary: Summary, doc: dict) -> None:
    own = doc.get("own")
    if not own:
        return
    values = own["values"]
    found = [k for k in DROPPED if _has_value(values, k)]
    for k in found:
        summary.records[k] += 1
    if not found:
        return
    deleted = bool(own.get("deletion") and own["deletion"][0])
    summary.deleted_records += deleted
    if values.get("date"):
        summary.days.add(values["date"])
    rest = _strip(values)
    if (not deleted and values.get("source") == "manual" and (rest.get("memo") or "") == ""
            and all(rest.get(k) is None for k in ("weight_kg", "body_fat_pct", "lean_mass_kg"))):
        summary.empty_after += 1


def _count_log(summary: Summary, entry: dict) -> None:
    for k in DROPPED:
        summary.log_changes[k] += _has_value(entry["change"].get("fields"), k)
    summary.log_states += any(_has_value(entry["state"].get("fields"), k) for k in DROPPED)


def _items(table):
    """同期の体組成の状態と変更の記録を、Scan で全部読む（読むだけ）。"""
    from boto3.dynamodb.conditions import Attr

    kwargs = {
        "FilterExpression": Attr("sk").begins_with(STATE_PREFIX) | Attr("sk").begins_with(LOG_PREFIX),
        "ProjectionExpression": "pk, sk, #d", "ExpressionAttributeNames": {"#d": "data"}, "ConsistentRead": True,
    }
    while True:
        page = table.scan(**kwargs)
        yield from page["Items"]
        if "LastEvaluatedKey" not in page:
            return
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def run(table, apply: bool, items=None) -> Summary:
    summary = Summary()
    for item in items if items is not None else _items(table):
        data = json.loads(item["data"])
        if item["sk"].startswith(STATE_PREFIX):
            _count_state(summary, data)
            new = scrub_state(data)
        elif item["sk"].startswith(LOG_PREFIX):
            if data["change"]["entity_type"] != "body_record":
                continue
            _count_log(summary, data)
            new = scrub_log(data)
        else:
            continue
        summary.users.add(item["pk"])
        if new is None:
            continue
        summary.to_rewrite += 1
        if apply:
            from botocore.exceptions import ClientError

            try:
                table.update_item(
                    Key={"pk": item["pk"], "sk": item["sk"]}, UpdateExpression="SET #d = :new",
                    ConditionExpression="#d = :old", ExpressionAttributeNames={"#d": "data"},
                    ExpressionAttributeValues={":new": json.dumps(new), ":old": item["data"]})
                summary.rewritten += 1
            except ClientError as e:
                if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
                summary.skipped += 1
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--table", required=True, help="MealsTable の名前")
    parser.add_argument("--apply", action="store_true", help="書き換える（付けなければ数えるだけ）")
    args = parser.parse_args()
    import boto3

    table = boto3.resource("dynamodb").Table(args.table)
    print("書き換える" if args.apply else "数えるだけ（書き換えない）")
    for line in run(table, args.apply).lines():
        print(line)


if __name__ == "__main__":
    main()
