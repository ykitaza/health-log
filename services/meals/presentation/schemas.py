"""ツールの入力の型。SDK がここから JSON Schema を作り、Claude に見せる。ドメインの型への変換もここで行う。"""

import datetime as dt
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field

from application.commands import NewItem, NewMeal
from domain.values import Confidence, EatenOn, MealSlot, Nutrition, Quantity, Source, Unit

SlotName = Literal["breakfast", "lunch", "dinner", "snack"]


def _not_blank(text: str) -> str:
    """空白だけの名前は断る（ドメインと同じく、前後の空白を除いてから確かめる）。"""
    if not text.strip():
        raise ValueError("空白だけにはできません")
    return text


# 上限は、アプリから届く変更と同じ（infrastructure/sync_entities.py。MCP で書いた変更も同期でアプリに降りるため）
Grams = Annotated[float, Field(ge=0, le=5000)]
Kcal = Annotated[float, Field(ge=0, le=20000)]
Amount = Annotated[float, Field(gt=0, le=100000)]
ItemName = Annotated[str, Field(min_length=1, max_length=200), AfterValidator(_not_blank)]
TemplateName = Annotated[str, Field(min_length=1, max_length=100), AfterValidator(_not_blank)]
BodyWeightKg = Annotated[float, Field(gt=0, le=300)]
ProteinPerKg = Annotated[float, Field(gt=0, le=5)]


class ItemInput(BaseModel):
    name: ItemName = Field(description="品目の名前。例：白米、鶏むね肉の照り焼き")
    amount: Amount = Field(description="量の数")
    unit: Literal["g", "ml", "個", "杯"]
    kcal: Kcal = Field(description="この量でのエネルギー")
    protein_g: Grams
    fat_g: Grams
    carbs_g: Grams
    confidence: Literal["high", "medium", "low"] = Field(
        "medium", description="推定の確かさ。写真から量を推定したものは low か medium")

    def to_command(self) -> NewItem:
        return NewItem(
            self.name,
            Quantity(self.amount, Unit(self.unit)),
            Nutrition(self.kcal, self.protein_g, self.fat_g, self.carbs_g),
            Confidence(self.confidence),
        )


class WhenInput(BaseModel):
    date: dt.date = Field(description="食べた日（YYYY-MM-DD）")
    slot: SlotName = Field(description="朝食・昼食・夕食・間食。利用者の指示、時刻、料理の内容の順で決める")
    time: dt.time | None = Field(None, description="食べた時刻（HH:MM）。分からなければ省く")

    def to_eaten_on(self) -> EatenOn:
        return EatenOn(self.date, MealSlot(self.slot), self.time)


class MealInput(WhenInput):
    items: list[ItemInput] = Field(min_length=1)
    description: str = Field(max_length=2000, description="写真や言葉から読み取った食事の説明。画像は保存しないので、ここに残す")
    source: Literal["photo", "text", "numbers"] = Field(description="写真から／言葉から／kcal・PFC の数値だけ")

    def to_command(self) -> NewMeal:
        return NewMeal(
            self.to_eaten_on(), tuple(i.to_command() for i in self.items), self.description, Source(self.source))


class AmountChange(BaseModel):
    item_id: str
    amount: Amount = Field(description="新しい量の数。単位は記録したときのまま")


class DailyTargetInput(BaseModel):
    kcal: Kcal
    fat_g: Grams
    carbs_g: Grams
