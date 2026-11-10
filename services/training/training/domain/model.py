"""筋トレのドメインの言葉。項目はアプリの SQLite（apps/mobile/db/migrations.ts）と同じ。

  部位（BodyPart）・種目（Exercise）       種目は1つの部位に属する。記録の仕方は「重量×回数」か「回数だけ」
  トレーニング（Workout）                  その日の種目（WorkoutEntry）と、種目ごとのセット（WorkoutSet）
  体組成（BodyRecord）                     1日に複数あり得る（体重計の取り込みと手入力など）
  睡眠（SleepSession）・心拍（HeartRateDay） アプリが Health Connect から取り込んだもの（読むだけ）
重さはいつも kg で持つ（表示の単位は設定で変える）。日付は端末の暦の日付（YYYY-MM-DD）。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class RecordType(Enum):
    WEIGHT_REPS = "weight_reps"  # 重量 × 回数
    REPS_ONLY = "reps_only"  # 回数だけ（自重など）


@dataclass(frozen=True)
class TraineeId:
    """記録の持ち主。食事の「食べた人」と同じく、Cognito の sub。"""

    value: str


@dataclass(frozen=True)
class BodyPart:
    id: str
    name: str
    sort_order: int
    hidden: bool


@dataclass(frozen=True)
class Exercise:
    id: str
    body_part_id: str
    name: str
    record_type: RecordType
    sort_order: int
    hidden: bool
    # 回数だけの種目の、体重に対する割合（0〜1）。None は名前から決める（training.domain.bodyweight）
    bodyweight_ratio: float | None = None
    # BIG3 の役（bench・squat・deadlift）。None は割り当てなし（どの種目にもなければ名前から決める。training.domain.big3）
    big3: str | None = None
    # フォームの動画のリンク（https:// で始まるもの）
    form_video_url: str | None = None


@dataclass(frozen=True)
class WorkoutSet:
    id: str
    set_index: int
    weight_kg: float | None  # 回数だけの種目は None
    reps: int
    memo: str = ""
    done: bool = False


@dataclass(frozen=True)
class WorkoutEntry:
    """1日の1種目ぶん。sort_order はその日に行った順。"""

    id: str
    date: str
    exercise_id: str
    sort_order: int
    sets: tuple[WorkoutSet, ...] = ()


@dataclass(frozen=True)
class Workout:
    """その日のトレーニング（種目とセット）。"""

    date: str
    entries: tuple[WorkoutEntry, ...]


@dataclass(frozen=True)
class SetRow:
    """集計に使う1セット分の行（アプリの TrainingSetRow と同じ）。"""

    date: str
    exercise_id: str
    body_part_id: str
    weight_kg: float | None
    reps: int | None
    bodyweight_ratio: float | None = None  # 回数だけの種目の割合（重量×回数の種目は None）
    bodyweight_load_kg: float | None = None  # 回数だけのセットの負荷（体重 × 割合）。体重がなければ None


@dataclass(frozen=True)
class BodyRecord:
    id: str
    date: str
    measured_at: str
    weight_kg: float | None
    body_fat_pct: float | None
    muscle_pct: float | None
    waist_cm: float | None
    memo: str
    source: str  # manual・health_connect
    updated_at: str


@dataclass(frozen=True)
class SleepSession:
    """睡眠の1回分（Health Connect の取り込み）。date は起きた日。asleep_min は起きていた分を引いたもの。"""

    id: str
    date: str
    start_at: str
    end_at: str
    asleep_min: int
    awake_min: int


@dataclass(frozen=True)
class HeartRateDay:
    """心拍の1日のまとめ（Health Connect の取り込み）。サンプルがない日は avg・min・max が None。"""

    date: str
    resting_bpm: float | None
    avg_bpm: float | None
    min_bpm: float | None
    max_bpm: float | None
    samples: int
