from meals.infrastructure.sync_entities import register as register_meal_entities
from sync.registry import Registry
from training.main import register_sync_entities as register_training_entities


def create_registry() -> Registry:
    """同期で扱う種類。食事と筋トレは、同じテーブルの同期の項目を読み書きする（アプリも MCP も同じ）。"""
    registry = Registry()
    register_meal_entities(registry)
    register_training_entities(registry)
    return registry
