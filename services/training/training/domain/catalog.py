"""部位と種目のカタログ：初期の部位と種目、名前での探し方。

初期の部位と種目は、アプリ（apps/mobile/db/seed.ts）と同じ固定の ID と名前にする（tests/test_catalog.py で確かめる）。
アプリが同期でまだ送っていなくても、MCP から同じ ID で記録できるようにするため。
同期に同じ ID の記録があれば、そちらを使う（名前を変えた・隠した・消したもの）。
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from training.domain.errors import NotFound, TrainingError
from training.domain.model import BodyPart, Exercise, RecordType

SEED_BODY_PARTS: tuple[BodyPart, ...] = tuple(BodyPart(i, name, n, False) for n, (i, name) in enumerate([
    ("3fbee59a-e853-47b5-a143-3c145c2248d7", "胸"),
    ("bf32f045-2308-4099-9a21-c5d683db9b81", "背中"),
    ("ec37dcca-4ba3-4121-ac04-60d61a8ef112", "肩"),
    ("4297851d-7332-40e6-9ad8-8e7c9aee7d2f", "脚"),
    ("e5e464f3-ce62-4396-ad40-8e25f464eae8", "上腕二頭筋"),
    ("8079335d-7d18-4764-9c17-06c91e153d62", "上腕三頭筋"),
    ("c9166ad9-9bab-4f2f-9af9-69c145ede18f", "腹筋"),
]))

_W, _R = RecordType.WEIGHT_REPS, RecordType.REPS_ONLY
SEED_EXERCISES: tuple[Exercise, ...] = tuple(Exercise(i, part, name, kind, n, False) for n, (i, part, name, kind) in enumerate([
    ("d41c7096-c246-4dfa-945a-e1cb329977a6", "3fbee59a-e853-47b5-a143-3c145c2248d7", "ベンチプレス", _W),
    ("62470461-a495-425d-87cd-7751b38993cc", "3fbee59a-e853-47b5-a143-3c145c2248d7", "インクラインダンベルプレス", _W),
    ("7a03db74-fc9b-454f-98bd-c36d6cca4dfa", "3fbee59a-e853-47b5-a143-3c145c2248d7", "ダンベルフライ", _W),
    ("aab7de2f-aaf3-43fe-80e7-34eff7375f36", "3fbee59a-e853-47b5-a143-3c145c2248d7", "ケーブルフライ", _W),
    ("21a1ef87-cb4b-42ea-81f2-a47fc123d68c", "3fbee59a-e853-47b5-a143-3c145c2248d7", "腕立て伏せ", _R),
    ("2b2e0dc4-c98d-4656-95f6-e9a21cf03004", "bf32f045-2308-4099-9a21-c5d683db9b81", "デッドリフト", _W),
    ("02415e5f-7beb-42b8-9572-2f7b6942a6da", "bf32f045-2308-4099-9a21-c5d683db9b81", "ラットプルダウン", _W),
    ("49c20811-a712-4f84-b156-8d4571c465b3", "bf32f045-2308-4099-9a21-c5d683db9b81", "ベントオーバーロウ", _W),
    ("0899dd52-5e21-4123-b917-fb2859b67f31", "bf32f045-2308-4099-9a21-c5d683db9b81", "シーテッドロウ", _W),
    ("11080b36-79ce-4306-a099-c779ae4323b3", "bf32f045-2308-4099-9a21-c5d683db9b81", "懸垂", _R),
    ("fc03a49d-a1f7-478a-b498-1ffaf4f08c5f", "ec37dcca-4ba3-4121-ac04-60d61a8ef112", "ショルダープレス", _W),
    ("213988f5-7619-44ec-8d5d-c429aa0150a6", "ec37dcca-4ba3-4121-ac04-60d61a8ef112", "サイドレイズ", _W),
    ("8b21c2a0-617d-4117-bb9d-29ec6075e477", "ec37dcca-4ba3-4121-ac04-60d61a8ef112", "リアレイズ", _W),
    ("a902b077-031a-4de6-814b-9ffb69b96778", "4297851d-7332-40e6-9ad8-8e7c9aee7d2f", "スクワット", _W),
    ("de80c2e1-a6bd-479f-81a4-67bf46091634", "4297851d-7332-40e6-9ad8-8e7c9aee7d2f", "レッグプレス", _W),
    ("f4e5b99e-69c9-4e32-b3a8-09a504b9bc12", "4297851d-7332-40e6-9ad8-8e7c9aee7d2f", "ルーマニアンデッドリフト", _W),
    ("8cf56999-18b6-4181-8b87-e6ff03e24f4a", "4297851d-7332-40e6-9ad8-8e7c9aee7d2f", "レッグエクステンション", _W),
    ("7b7a534d-e5aa-4a05-bc80-5abe5a01a9d9", "4297851d-7332-40e6-9ad8-8e7c9aee7d2f", "レッグカール", _W),
    ("03b4fdba-721e-4c90-ad62-4dd44e25b064", "e5e464f3-ce62-4396-ad40-8e25f464eae8", "バーベルカール", _W),
    ("bfea78af-73b3-47a6-a6a2-3a67532f7202", "e5e464f3-ce62-4396-ad40-8e25f464eae8", "ダンベルカール", _W),
    ("295306fe-33cf-4994-9e57-59e4510b3816", "e5e464f3-ce62-4396-ad40-8e25f464eae8", "ハンマーカール", _W),
    ("c6660364-90b4-464b-bf47-d8c9d2462e98", "8079335d-7d18-4764-9c17-06c91e153d62", "トライセプスプレスダウン", _W),
    ("735f24df-cfb2-4bf4-94d3-d857db3b0671", "8079335d-7d18-4764-9c17-06c91e153d62", "ライイングトライセプスエクステンション", _W),
    ("ab83499c-9ce9-4749-ae49-24275c91de93", "8079335d-7d18-4764-9c17-06c91e153d62", "ディップス", _R),
    ("6a258b3f-f7a5-4098-9b17-67d95768cb55", "c9166ad9-9bab-4f2f-9af9-69c145ede18f", "クランチ", _R),
    ("c308d40e-c944-4ee2-a5a0-1a1c946dd532", "c9166ad9-9bab-4f2f-9af9-69c145ede18f", "レッグレイズ", _R),
    ("f0930e1c-8c23-400c-9d59-5a91d52b9f7e", "c9166ad9-9bab-4f2f-9af9-69c145ede18f", "アブローラー", _R),
]))


def normalize(name: str) -> str:
    """名前を比べる形：全角と半角をそろえ（NFKC）、大文字と小文字を同じにし、空白を除く。"""
    return "".join(unicodedata.normalize("NFKC", name).casefold().split())


@dataclass(frozen=True)
class Catalog:
    """その人の部位と種目（初期のものと、同期された記録を合わせたもの。消したものは含めない）。"""

    body_parts: tuple[BodyPart, ...]
    exercises: tuple[Exercise, ...]

    def body_part(self, body_part_id: str) -> BodyPart | None:
        return next((p for p in self.body_parts if p.id == body_part_id), None)

    def exercise(self, exercise_id: str) -> Exercise | None:
        return next((e for e in self.exercises if e.id == exercise_id), None)

    def find_exercise(self, query: str) -> Exercise:
        """種目を ID か名前で探す。名前は、比べる形（normalize）で完全に一致するものだけを使う。

        「ベンチ」で「ベンチプレス」を選ぶような推測はしない（別の種目を選んで記録が混ざるのを防ぐ）。
        見つからないとき・2つ以上あるときは、候補を添えて断り、AI に名前を選び直させる。
        """
        found = self.exercise(query.strip())
        if found:
            return found
        key = normalize(query)
        exact = [e for e in self.exercises if normalize(e.name) == key]
        if len(exact) == 1:
            return exact[0]
        if len(exact) > 1:
            raise TrainingError(f"「{query}」という種目が{len(exact)}つあります。exercise_id で指定してください："
                                + self._describe(exact))
        similar = [e for e in self.exercises if key and (key in normalize(e.name) or normalize(e.name) in key)]
        if similar:
            raise NotFound(f"「{query}」という名前の種目はありません。近い名前：{self._describe(similar[:10])}。"
                           "利用者の意図がはっきりしていればその名前で、迷うなら利用者に確かめてから呼び直してください")
        raise NotFound(f"「{query}」という名前の種目はありません。list_exercises で名前を確かめるか、"
                       "新しい種目なら add_exercise で足してください")

    def find_body_part(self, query: str) -> BodyPart:
        found = self.body_part(query.strip())
        if found:
            return found
        key = normalize(query)
        exact = [p for p in self.body_parts if normalize(p.name) == key]
        if len(exact) == 1:
            return exact[0]
        names = "、".join(p.name for p in self.body_parts if not p.hidden)
        raise NotFound(f"「{query}」という部位はありません。部位：{names}")

    def _describe(self, exercises: list[Exercise]) -> str:
        def part(e: Exercise) -> str:
            p = self.body_part(e.body_part_id)
            return p.name if p else "?"
        return "、".join(f"{e.name}（{part(e)}、{e.id}）" for e in exercises)
