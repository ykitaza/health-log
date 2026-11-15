import { BALANCE_PARTS } from '../partBalance';
import { partVolume, volumeDeltaText, volumeLabel, volumeLevel, volumeMuscleLevels, volumeRowText } from '../partVolume';
import type { TrainingSetRow } from '../training';

const NAMES: Record<string, string> = {
  chest: '胸', back: '背中', shoulder: '肩', legs: '脚', biceps: '上腕二頭筋', triceps: '上腕三頭筋', abs: '腹筋', calf: 'ふくらはぎ',
};
const nameOf = (id: string) => NAMES[id] ?? '';
const rows = (date: string, part: string, n: number, extra: Partial<TrainingSetRow> = {}): TrainingSetRow[] =>
  Array.from({ length: n }, () => ({ date, exerciseId: 'e', bodyPartId: part, weightKg: 50, reps: 10, ...extra }));
const sets = (v: ReturnType<typeof partVolume>) => v.parts.map((p) => p.sets);
const rowOf = (v: ReturnType<typeof partVolume>, part: string) => v.parts.find((p) => p.part === part)!;

describe('volumeLevel：0 / 1〜4 / 5〜9 / 10〜14 / 15〜20 / 21 以上', () => {
  test.each([
    [0, 0], [1, 1], [4, 1], [5, 2], [9, 2], [10, 3], [14, 3], [15, 4], [20, 4], [21, 5], [60, 5],
  ])('%i セット → %i 段', (n, level) => {
    expect(volumeLevel(n)).toBe(level);
  });
});

describe('partVolume：期間', () => {
  // 2026-11-02 は月曜、11-08 は日曜
  const data = [
    ...rows('2026-11-04', 'chest', 12), // 今週の水曜
    ...rows('2026-11-06', 'back', 5), // 今週の金曜（水曜より後）
    ...rows('2026-10-26', 'chest', 3), // 先週の月曜
    ...rows('2026-10-28', 'chest', 2), // 先週の水曜（同じ曜日まで）
    ...rows('2026-10-30', 'back', 4), // 先週の金曜
    ...rows('2026-10-29', 'legs', 6), // 先週の木曜（水曜より後）
    ...rows('2026-10-25', 'chest', 9), // 先々週の日曜（先週の外）
  ];

  test('今週の途中（月曜〜今日）：今日までに切り、前は先週の同じ曜日まで。目安を出す', () => {
    const v = partVolume(data, nameOf, '2026-11-02', '2026-11-08', '2026-11-04');
    expect(v).toMatchObject({ from: '2026-11-02', to: '2026-11-04', previous_from: '2026-10-26', previous_to: '2026-10-28', band: { min: 10, max: 20 } });
    expect(sets(v)).toEqual([12, 0, 0, 0, 0, 0]);
    expect(v.parts.map((p) => p.previous)).toEqual([5, 0, 0, 0, 0, 0]);
    expect(rowOf(v, '胸')).toEqual({ part: '胸', sets: 12, previous: 5, delta: 7, short: 0, over: 0, trend: 'toward' });
    expect(v.parts.map((p) => p.part)).toEqual([...BALANCE_PARTS]);
  });

  test('今週を全部（月曜〜日曜）：今日が過ぎていれば日曜まで、前は前の週の月曜〜日曜', () => {
    const v = partVolume(data, nameOf, '2026-11-02', '2026-11-08', '2026-11-09');
    expect(v).toMatchObject({ from: '2026-11-02', to: '2026-11-08', previous_from: '2026-10-26', previous_to: '2026-11-01' });
    expect(sets(v)).toEqual([12, 0, 5, 0, 0, 0]);
    expect(v.parts.map((p) => p.previous)).toEqual([5, 0, 4, 0, 6, 0]);
    expect(rowOf(v, '脚')).toMatchObject({ sets: 0, previous: 6, delta: -6, short: 10, over: 0, trend: 'away' });
  });

  test('日曜の今日：週の終わりと今日が同じ日なら全部', () => {
    const v = partVolume(data, nameOf, '2026-11-02', '2026-11-08', '2026-11-08');
    expect(v.to).toBe('2026-11-08');
    expect(v.previous_to).toBe('2026-11-01');
  });

  test('月（7 日より長い）：目安の項目（band・short・over）は出さず、前は 7 の倍数の日数だけ前', () => {
    // 30 日 → 35 日前
    const v = partVolume(data, nameOf, '2026-11-01', '2026-11-30', '2026-11-15');
    expect(v).toMatchObject({ from: '2026-11-01', to: '2026-11-15', previous_from: '2026-09-27', previous_to: '2026-10-11' });
    expect(v).not.toHaveProperty('band');
    for (const p of v.parts) {
      expect(p).not.toHaveProperty('short');
      expect(p).not.toHaveProperty('over');
      expect(p).not.toHaveProperty('trend');
    }
    expect(sets(v)).toEqual([12, 0, 5, 0, 0, 0]);
  });

  test('数え方は partBalanceBetween と同じ：1行が1セット、done は見ない、回数だけのセットも数える。知らない部位は数えない', () => {
    const v = partVolume([
      ...rows('2026-11-03', 'biceps', 2), ...rows('2026-11-03', 'triceps', 1, { weightKg: null, reps: 8 }), ...rows('2026-11-03', 'abs', 1, { reps: null }),
      ...rows('2026-11-03', 'calf', 4),
    ], nameOf, '2026-11-02', '2026-11-08', '2026-11-04');
    expect(sets(v)).toEqual([0, 0, 0, 3, 0, 1]);
  });

  test('記録がなければ、すべて 0 で変化なし', () => {
    const v = partVolume([], nameOf, '2026-11-02', '2026-11-08', '2026-11-04');
    expect(v.parts.every((p) => p.sets === 0 && p.previous === 0 && p.delta === 0 && p.trend === 'same' && p.short === 10 && p.over === 0)).toBe(true);
  });
});

describe('partVolume：目安（10〜20）と向き', () => {
  const at = (cur: number, prev: number) => {
    const v = partVolume([...rows('2026-11-03', 'chest', cur), ...rows('2026-10-27', 'chest', prev)], nameOf, '2026-11-02', '2026-11-08', '2026-11-04');
    return rowOf(v, '胸');
  };

  test('short は 10 まであと何セット、over は 20 を何セット超えたか', () => {
    expect(at(6, 0)).toMatchObject({ short: 4, over: 0 });
    expect(at(10, 0)).toMatchObject({ short: 0, over: 0 });
    expect(at(20, 0)).toMatchObject({ short: 0, over: 0 });
    expect(at(23, 0)).toMatchObject({ short: 0, over: 3 });
  });

  test('toward：目安までの距離が縮んだ（下から近づく、上から戻る、目安の中に入る）', () => {
    expect(at(8, 3).trend).toBe('toward');
    expect(at(25, 30).trend).toBe('toward');
    expect(at(12, 4).trend).toBe('toward');
  });

  test('away：距離が伸びた（目安の中から出る、下がる、上がる）', () => {
    expect(at(5, 8).trend).toBe('away');
    expect(at(25, 12).trend).toBe('away');
    expect(at(2, 14).trend).toBe('away');
  });

  test('same：距離が同じ（目安の中どうし、どちらも 0 セット、同じ数）', () => {
    expect(at(15, 11).trend).toBe('same');
    expect(at(0, 0).trend).toBe('same');
    expect(at(4, 4).trend).toBe('same');
    // 目安の下と上で、同じ距離
    expect(at(7, 23).trend).toBe('same');
  });
});

describe('文字と読み上げ', () => {
  const week = (cur: [string, number][], prev: [string, number][] = []) =>
    partVolume([...cur.flatMap(([p, n]) => rows('2026-11-03', p, n)), ...prev.flatMap(([p, n]) => rows('2026-10-27', p, n))], nameOf, '2026-11-02', '2026-11-08', '2026-11-04');

  test('行の文字：目安に届かないと「6／10 あと4」、目安の中は「目安内」、超えたら「目安より多い」。月は数だけ', () => {
    const v = week([['chest', 6], ['back', 12], ['legs', 24]]);
    expect(volumeRowText(rowOf(v, '胸'))).toBe('6／10 あと4');
    expect(volumeRowText(rowOf(v, '背中'))).toBe('12 目安内');
    expect(volumeRowText(rowOf(v, '脚'))).toBe('24 目安より多い');
    expect(volumeRowText(rowOf(v, '肩'))).toBe('0／10 あと10');
    const month = partVolume(rows('2026-11-03', 'chest', 30), nameOf, '2026-11-01', '2026-11-30', '2026-11-15');
    expect(volumeRowText(rowOf(month, '胸'))).toBe('30');
  });

  test('前との差の文字：先週 +2、先週 −3、先週 ±0。月は「前の期間」', () => {
    const v = week([['chest', 6], ['back', 2]], [['chest', 4], ['back', 5]]);
    expect(volumeDeltaText(rowOf(v, '胸'), true)).toBe('先週 +2');
    expect(volumeDeltaText(rowOf(v, '背中'), true)).toBe('先週 −3');
    expect(volumeDeltaText(rowOf(v, '肩'), true)).toBe('先週 ±0');
    expect(volumeDeltaText(rowOf(v, '胸'), false)).toBe('前の期間 +2');
  });

  test('読み上げ：期間・目安・部位ごとのセット数と目安との差・先週との差・ケガ', () => {
    const v = week([['chest', 6]], [['chest', 4]]);
    const label = volumeLabel(v, '今週の部位', new Set(['腕'] as const));
    expect(label.startsWith('今週の部位、11月2日から11月4日のセット数（目安は 1 週間 10〜20）。')).toBe(true);
    expect(label).toContain('胸 6 セット、あと4、先週より 2 セット増えた、目安に近づいた');
    expect(label).toContain('肩 0 セット、あと10、先週と同じ');
    expect(label).toContain('腕 0 セット、あと10、先週と同じ、ケガ');
    expect(label).not.toContain('肩 0 セット、あと10、先週と同じ、ケガ');
  });

  test('読み上げ：目安の中・多い・減った・月、記録がなければそのこと', () => {
    const v = week([['chest', 12], ['legs', 24]], [['legs', 30]]);
    const label = volumeLabel(v, 'この週の部位');
    expect(label).toContain('胸 12 セット、目安内、先週より 12 セット増えた、目安に近づいた');
    expect(label).toContain('脚 24 セット、目安より多い、先週より 6 セット減った、目安に近づいた');
    expect(volumeLabel(week([]), '今週の部位')).toBe('今週の部位、11月2日から11月4日のセット数（目安は 1 週間 10〜20）。まだ記録がありません');
    const month = partVolume(rows('2026-11-03', 'chest', 30), nameOf, '2026-11-01', '2026-11-30', '2026-11-15');
    expect(volumeLabel(month, '月の部位')).toContain('胸 30 セット、前の期間より 30 セット増えた');
    expect(volumeLabel(month, '月の部位')).not.toContain('目安');
  });
});

describe('volumeMuscleLevels：2D の図の筋肉ごとの段', () => {
  test('部位の筋肉を、その部位のセット数の段にする（腕は二頭筋・三頭筋・前腕）。記録のない部位は 0 段', () => {
    const v = partVolume(
      [...rows('2026-11-03', 'chest', 12), ...rows('2026-11-03', 'biceps', 3), ...rows('2026-11-03', 'triceps', 3), ...rows('2026-11-03', 'legs', 25)],
      nameOf, '2026-11-02', '2026-11-08', '2026-11-04',
    );
    const levels = volumeMuscleLevels(v);
    expect(levels.pecs).toBe(3);
    expect(levels.biceps).toBe(2);
    expect(levels.triceps).toBe(2);
    expect(levels.forearm).toBe(2);
    expect(levels.quads).toBe(5);
    expect(levels.glutes).toBe(5);
    expect(levels.abs).toBe(0);
    expect(levels.deltoid).toBe(0);
  });
});
