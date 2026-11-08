"""今の食事・いつもの・目標・日の種類（MEAL#・TEMPLATE#・GOAL・DAYTYPE#）を、同期の変更の記録に移す。

手順は docs/sync-design.md の「今あるデータの移行」。既定は読み取りだけ（--apply で書く）。

  cd services/meals
  AWS_PROFILE=yuki AWS_REGION=ap-northeast-1 PYTHONPATH=. uv run python scripts/migrate_to_sync.py --table <MealsTable の名前>
  AWS_PROFILE=yuki AWS_REGION=ap-northeast-1 PYTHONPATH=. uv run python scripts/migrate_to_sync.py --table <名前> --apply

- 古い項目は消さない（もとに戻すときのため）。体重（WEIGHT#）は移さない
- change_id は「pk・sk・中身」から決めるので、何度動かしても、中身が同じものは duplicate になる
- 画面に出すのは件数だけ（利用者の ID や記録の中身は出さない）
"""

from __future__ import annotations

import argparse
import hashlib
import json
import uuid
from collections import Counter

from infrastructure.serialization import goal_from_dict, meal_from_dict, template_from_dict
from infrastructure.sync_repositories import (
    GOAL_ID,
    goal_fields,
    meal_fields,
    meal_item_fields,
    template_fields,
    template_id,
)
from sync.engine import SyncEngine
from sync.model import Change, utc_now
from sync.store import DynamoDBSyncStore

MIGRATION_NAMESPACE = uuid.UUID("0b8f6c1e-3f4a-4f0e-9a51-7d2b9c4e8a10")
EATER_PREFIX = "EATER#"


def changes_for(item: dict, changed_at: str) -> list[Change]:
    """古い項目1つを、create の変更にする。移すものでなければ空。"""
    sk = item["sk"]
    digest = hashlib.sha256(item.get("data", "").encode()).hexdigest()

    def make(n: int, entity_type: str, entity_id: str, fields: dict, parent_id: str | None = None) -> Change:
        change_id = str(uuid.uuid5(MIGRATION_NAMESPACE, f"{item['pk']}|{sk}|{digest}|{n}"))
        return Change(change_id, entity_type, entity_id, parent_id, "create", fields, changed_at, "migration")

    data = json.loads(item["data"]) if "data" in item else None
    if sk.startswith("MEAL#"):
        meal = meal_from_dict(data)
        return [make(0, "meal", meal.id, meal_fields(meal))] + [
            make(n, "meal_item", i.id, meal_item_fields(i, n - 1), parent_id=meal.id)
            for n, i in enumerate(meal.items, 1)]
    if sk.startswith("TEMPLATE#"):
        template = template_from_dict(data)
        return [make(0, "meal_template", template_id(template.name), template_fields(template))]
    if sk == "GOAL":
        return [make(0, "nutrition_goal", GOAL_ID, goal_fields(goal_from_dict(data)))]
    if sk.startswith("DAYTYPE#"):
        return [make(0, "day_type", sk.removeprefix("DAYTYPE#"), {"day_type": data["day_type"]})]
    return []  # 体重、同期の項目など


def scan(table) -> list[dict]:
    items, start_key = [], None
    while True:
        page = table.scan(**({"ExclusiveStartKey": start_key} if start_key else {}))
        items += page["Items"]
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return items


def migrate(table_name: str, apply: bool, changed_at: str | None = None) -> Counter:
    store = DynamoDBSyncStore(table_name)
    engine = SyncEngine(store)
    changed_at = changed_at or utc_now()
    counts: Counter = Counter()
    by_user: dict[str, list[Change]] = {}
    for item in scan(store.table):
        if not item["pk"].startswith(EATER_PREFIX):
            continue
        changes = changes_for(item, changed_at)
        if changes:
            counts[changes[0].entity_type] += 1
            by_user.setdefault(item["pk"].removeprefix(EATER_PREFIX), []).extend(changes)
    counts["users"] = len(by_user)
    for user, changes in by_user.items():
        counts["changes"] += len(changes)
        if apply:
            for result in engine.append(user, changes):
                counts["duplicate" if result.duplicate else "accepted"] += 1
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--table", required=True, help="食事のテーブル（MealsTable）の名前")
    parser.add_argument("--apply", action="store_true", help="書く（付けなければ件数を数えるだけ）")
    args = parser.parse_args()
    counts = migrate(args.table, args.apply)
    print(("書きました" if args.apply else "読み取りだけ（--apply で書く）"), dict(sorted(counts.items())))


if __name__ == "__main__":
    main()
