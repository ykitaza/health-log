"""docs/api/words-app-api.yaml が、サーバーの登録（sync_entities.py）から作ったものと同じか（アプリとの約束がずれないように）。"""

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "gen_openapi.py"


def test_仕様のファイルは今の登録と同じ():
    spec = importlib.util.spec_from_file_location("gen_openapi", SCRIPT)
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    assert gen.TARGET.read_text() == gen.render(), "uv run python scripts/gen_openapi.py で作り直してください"
