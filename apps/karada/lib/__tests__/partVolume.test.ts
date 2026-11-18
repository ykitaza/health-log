import { BALANCE_PARTS } from '../partBalance';
import {
  heroVolumeCaption, heroVolumeGlow, heroVolumeLevels, heroVolumeSpoken, parseHeroBodyMode, partVolume, phaseLevel, phasePartVolume, phaseTotalSets, phaseVolumeLabel,
  phaseWindowOf, setsText, volumeDeltaText, volumeGlowLevel, volumeLabel, volumeLevel, volumeMuscleLevels, volumeRowText, volumeWindow, weekRoundedText,
} from '../partVolume';
import { endDateFor, Phase } from '../phases';
import { recoveryMeshesFor } from '../recoveryMap';
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

  test('前との差の文字：先週比 +2、先週比 −3、先週比 ±0。月は「前の期間比」。週のまとめは「前週比」', () => {
    const v = week([['chest', 6], ['back', 2]], [['chest', 4], ['back', 5]]);
    expect(volumeDeltaText(rowOf(v, '胸'), true)).toBe('先週比 +2');
    expect(volumeDeltaText(rowOf(v, '背中'), true)).toBe('先週比 −3');
    expect(volumeDeltaText(rowOf(v, '肩'), true)).toBe('先週比 ±0');
    expect(volumeDeltaText(rowOf(v, '胸'), false)).toBe('前の期間比 +2');
    expect(volumeDeltaText(rowOf(v, '胸'), true, '前週')).toBe('前週比 +2');
    expect(volumeLabel(v, '部位の量', new Set(), '前週')).toContain('胸 6 セット、あと4、前週比で 2 セット増えた');
  });

  test('読み上げ：期間・目安・部位ごとのセット数と目安との差・先週との差・ケガ', () => {
    const v = week([['chest', 6]], [['chest', 4]]);
    const label = volumeLabel(v, '今週の部位', new Set(['腕'] as const));
    expect(label.startsWith('今週の部位、11月2日から11月4日のセット数（目安は 1 週間 10〜20）。')).toBe(true);
    expect(label).toContain('胸 6 セット、あと4、先週比で 2 セット増えた、目安に近づいた');
    expect(label).toContain('肩 0 セット、あと10、先週比で変わらず');
    expect(label).toContain('腕 0 セット、あと10、先週比で変わらず、ケガ');
    expect(label).not.toContain('肩 0 セット、あと10、先週比で変わらず、ケガ');
  });

  test('読み上げ：目安の中・多い・減った・月、記録がなければそのこと', () => {
    const v = week([['chest', 12], ['legs', 24]], [['legs', 30]]);
    const label = volumeLabel(v, 'この週の部位');
    expect(label).toContain('胸 12 セット、目安内、先週比で 12 セット増えた、目安に近づいた');
    expect(label).toContain('脚 24 セット、目安より多い、先週比で 6 セット減った、目安に近づいた');
    expect(volumeLabel(week([]), '今週の部位')).toBe('今週の部位、11月2日から11月4日のセット数（目安は 1 週間 10〜20）。まだ記録がありません');
    const month = partVolume(rows('2026-11-03', 'chest', 30), nameOf, '2026-11-01', '2026-11-30', '2026-11-15');
    expect(volumeLabel(month, '月の部位')).toContain('胸 30 セット、前の期間比で 30 セット増えた');
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

describe('heroVolumeLevels：ホームの 3D の体の部品ごとの段', () => {
  const v = partVolume(
    [...rows('2026-11-03', 'chest', 12), ...rows('2026-11-03', 'biceps', 3), ...rows('2026-11-03', 'triceps', 3), ...rows('2026-11-03', 'legs', 25)],
    nameOf, '2026-11-02', '2026-11-08', '2026-11-04',
  );

  test('どの軸の部品も、その軸の段になる（左右の部品は両方）', () => {
    const levels = heroVolumeLevels(v);
    const expected: Record<string, number> = { 胸: 3, 腕: 2, 脚: 5, 肩: 0, 背中: 0, 腹: 0 };
    for (const [part, level] of Object.entries(expected)) {
      const meshes = recoveryMeshesFor(part);
      expect(meshes.length).toBeGreaterThan(0);
      for (const m of meshes) expect(levels[m]).toBe(level);
    }
    expect(levels.pec_r).toBe(3);
    expect(levels.pec_l).toBe(3);
    expect(levels.abs).toBe(0);
  });

  test('0 セットの軸の部品も 0 で入る（空の色にする）', () => {
    const levels = heroVolumeLevels(partVolume([], nameOf, '2026-11-02', '2026-11-08', '2026-11-04'));
    expect(Object.keys(levels).length).toBeGreaterThan(0);
    expect(Object.values(levels).every((l) => l === 0)).toBe(true);
  });

  test('知らない部位は部品がないので入らない', () => {
    const odd = { ...v, parts: [...v.parts, { part: '首' as never, sets: 30, previous: 0, delta: 30 }] };
    expect(heroVolumeLevels(odd)).toEqual(heroVolumeLevels(v));
  });
});

describe('heroVolumeGlow：場面に渡す形', () => {
  test('段 ÷ 5 の明るさ。0 の部品は明るさに入れず、空の部品に回す。段に戻せる', () => {
    const { glow, idle } = heroVolumeGlow({ pec_r: 3, quad_r: 5, abs: 0, delt_mid_l: 1 });
    expect(glow).toEqual({ pec_r: 0.6, quad_r: 1, delt_mid_l: 0.2 });
    expect(idle).toEqual(['abs']);
    expect(Object.values(glow).map(volumeGlowLevel)).toEqual([3, 5, 1]);
  });
});

describe('heroVolumeSpoken・parseHeroBodyMode', () => {
  test('読み上げは、見出し（期間の合計）と 6 軸のセット数。色は週あたりと添える', () => {
    const w = { kind: 'recent' as const, title: '直近4週の部位', label: '直近4週', from: '2026-10-20', to: '2026-11-16', rehab: [] };
    const v = phasePartVolume(rows('2026-11-03', 'chest', 28), nameOf, w);
    expect(heroVolumeSpoken(v)).toBe('直近4週で 28セット、10月20日から11月16日。胸 28 セット、肩 0 セット、背中 0 セット、腕 0 セット、脚 0 セット、腹 0 セット。体の色は 1 週間あたりの量');
  });

  test('覚えていた値：volume 以外（知らない値・覚えていないとき）は回復', () => {
    expect(parseHeroBodyMode('volume')).toBe('volume');
    expect(parseHeroBodyMode('recovery')).toBe('recovery');
    expect(parseHeroBodyMode('x')).toBe('recovery');
    expect(parseHeroBodyMode(null)).toBe('recovery');
  });
});

// ---- ホーム：フェーズの週あたり ----
const phase = (over: Partial<Phase> = {}): Phase => ({
  id: 'p1', kind: 'normal', direction: 'bulk', name: '', startDate: '2026-11-02', endDate: endDateFor('2026-11-02', 8), targetWeightKg: 80,
  mealTargets: null, snapshot: null, status: 'active', pausedPhaseId: null, targetHistory: [], endedOn: null, createdAt: '2026-11-02T00:00:00.000Z', ...over,
});
const rehabPhase = (over: Partial<Phase> = {}): Phase => phase({
  id: 'r1', kind: 'rehab', direction: null, endDate: null, targetWeightKg: null, startDate: '2026-11-09', pausedPhaseId: 'p1',
  createdAt: '2026-11-09T00:00:00.000Z', ...over,
});
const chestRows = (date: string, n: number) => rows(date, 'chest', n);

describe('volumeWindow：数える期間', () => {
  test('今のフェーズ：始まりから今日まで。見出しはフェーズの名前（なければ「増量 8週」）', () => {
    const w = volumeWindow([phase()], '2026-11-16');
    expect(w).toEqual({ kind: 'phase', title: '増量 8週の部位', label: '増量 8週', from: '2026-11-02', to: '2026-11-16', rehab: [] });
    expect(volumeWindow([phase({ name: '夏の増量' })], '2026-11-16').title).toBe('夏の増量の部位');
  });

  test('フェーズがない：今日までの 28 日（今日を含む）。見出しは「直近4週の部位」', () => {
    expect(volumeWindow([], '2026-11-16')).toEqual({ kind: 'recent', title: '直近4週の部位', label: '直近4週', from: '2026-10-20', to: '2026-11-16', rehab: [] });
  });

  test('終えたフェーズだけで、次がない：28 日。始まる前のフェーズも選ばない', () => {
    const ended = phase({ status: 'ended', endedOn: '2026-11-10' });
    expect(volumeWindow([ended], '2026-11-16').kind).toBe('recent');
    expect(volumeWindow([phase({ startDate: '2026-11-20' })], '2026-11-16').kind).toBe('recent');
  });

  test('終えた日（endedOn。その日は含まない）があるフェーズは、その前の日まで', () => {
    const ended = phase({ status: 'ended', endedOn: '2026-11-10' });
    expect(phaseWindowOf(ended, [ended], '2026-11-16')).toMatchObject({ from: '2026-11-02', to: '2026-11-09' });
    // 過去の日を見ていて、まだ続いていた日なら今日（asOf）まで
    expect(phaseWindowOf(ended, [ended], '2026-11-05').to).toBe('2026-11-05');
  });

  test('予定の終了日を過ぎても実施中のフェーズは、今日まで（予定の日では切らない）', () => {
    const over = phase({ endDate: '2026-11-08' });
    expect(volumeWindow([over], '2026-11-16')).toMatchObject({ kind: 'phase', from: '2026-11-02', to: '2026-11-16' });
  });

  test('療養で止まった日は rehab に入る（終えた療養は終わった日の前まで）', () => {
    const r = rehabPhase({ status: 'ended', endedOn: '2026-11-13' });
    expect(volumeWindow([phase(), r], '2026-11-16').rehab).toEqual([['2026-11-09', '2026-11-13']]);
  });

  test('療養中：止めた通常のフェーズの期間（療養の日は、今日まで止まっている）。見出しは止めたフェーズのもの', () => {
    const w = volumeWindow([phase(), rehabPhase()], '2026-11-16');
    expect(w).toEqual({ kind: 'phase', title: '増量 8週の部位', label: '増量 8週', from: '2026-11-02', to: '2026-11-16', rehab: [['2026-11-09', '2026-11-17']] });
  });

  test('療養中で止めたフェーズが見つからない：28 日（療養の日は引かない）', () => {
    const w = volumeWindow([rehabPhase({ pausedPhaseId: null })], '2026-11-16');
    expect(w).toEqual({ kind: 'recent', title: '直近4週の部位', label: '直近4週', from: '2026-10-20', to: '2026-11-16', rehab: [] });
  });
});

describe('phasePartVolume：週あたり', () => {
  const window = (over: Partial<Parameters<typeof phasePartVolume>[2]> = {}) =>
    ({ kind: 'phase' as const, title: '増量 8週の部位', label: '増量 8週', from: '2026-11-02', to: '2026-11-16', rehab: [], ...over });
  const chest = (v: ReturnType<typeof phasePartVolume>) => v.parts.find((p) => p.part === '胸')!;

  test('期間の外の記録は数えない。数え方は部位のバランスと同じ（1 行 1 セット、回数だけも数える）', () => {
    const data = [
      ...chestRows('2026-11-01', 9), ...chestRows('2026-11-02', 4), ...chestRows('2026-11-16', 2), ...chestRows('2026-11-17', 7),
      ...rows('2026-11-10', 'back', 3, { weightKg: null }),
    ];
    const v = phasePartVolume(data, nameOf, window());
    expect(v).toMatchObject({ days: 15, effectiveDays: 15, weeks: 15 / 7 });
    expect(chest(v).total).toBe(6);
    expect(v.parts.find((p) => p.part === '背中')!.total).toBe(3);
    expect(v.parts.map((p) => p.part)).toEqual([...BALANCE_PARTS]);
  });

  test('1 週間あたり = セット数 ÷ weeks。小数 1 桁に四捨五入。目安との差もその値から', () => {
    // 15 日 → weeks 15/7。16 セット → 7.47 → 7.5
    const v = phasePartVolume(chestRows('2026-11-05', 16), nameOf, window());
    expect(chest(v)).toEqual({ part: '胸', total: 16, perWeek: 7.5, level: 2, short: 2.5, over: 0 });
    // 8 週間（56 日）で 64 セット → 8.0
    const long = phasePartVolume(chestRows('2026-11-05', 64), nameOf, window({ from: '2026-09-22', to: '2026-11-16' }));
    expect(long.weeks).toBe(8);
    expect(chest(long)).toMatchObject({ perWeek: 8, short: 2, over: 0, level: 2 });
  });

  test('7 日の下限：始まったばかりでも、週あたりは 7 日でならす', () => {
    const v = phasePartVolume(chestRows('2026-11-16', 10), nameOf, window({ from: '2026-11-16', to: '2026-11-16' }));
    expect(v).toMatchObject({ days: 1, effectiveDays: 1, weeks: 1 });
    expect(chest(v)).toMatchObject({ total: 10, perWeek: 10, level: 3, short: 0, over: 0 });
    // 7 日ちょうど
    expect(phasePartVolume([], nameOf, window({ from: '2026-11-10', to: '2026-11-16' })).weeks).toBe(1);
  });

  test('療養の日の記録は数えず、療養の日は日数から引く', () => {
    const data = [...chestRows('2026-11-05', 6), ...chestRows('2026-11-10', 5), ...chestRows('2026-11-14', 4)];
    // 11/9〜11/12 が療養（[11/9, 11/13)）。15 日 − 4 日 = 11 日
    const v = phasePartVolume(data, nameOf, window({ rehab: [['2026-11-09', '2026-11-13']] }));
    expect(v).toMatchObject({ days: 15, effectiveDays: 11, weeks: 11 / 7 });
    expect(chest(v).total).toBe(10);
    expect(chest(v).perWeek).toBe(6.4); // 10 × 7 ÷ 11 = 6.36
  });

  test('療養が期間のほとんどでも、weeks は 1 以上', () => {
    const v = phasePartVolume(chestRows('2026-11-03', 5), nameOf, window({ rehab: [['2026-11-04', '2026-11-17']] }));
    expect(v.effectiveDays).toBe(2);
    expect(v.weeks).toBe(1);
    expect(chest(v).total).toBe(5);
  });

  test('28 日（フェーズなし）：4 週。56 セットなら週 14.0', () => {
    const w = volumeWindow([], '2026-11-16');
    const v = phasePartVolume(chestRows('2026-11-05', 56), nameOf, w);
    expect(v).toMatchObject({ kind: 'recent', days: 28, weeks: 4 });
    expect(chest(v)).toMatchObject({ perWeek: 14, level: 3 });
  });

  test('終えたフェーズ：終えた日の前までの記録だけ', () => {
    const ended = phase({ status: 'ended', endedOn: '2026-11-10' });
    const v = phasePartVolume([...chestRows('2026-11-09', 3), ...chestRows('2026-11-10', 8)], nameOf, phaseWindowOf(ended, [ended], '2026-11-16'));
    expect(v).toMatchObject({ to: '2026-11-09', days: 8 });
    expect(chest(v).total).toBe(3);
  });

  test('記録がなければすべて 0 段・目安まであと 10', () => {
    const v = phasePartVolume([], nameOf, window());
    expect(v.parts.every((p) => p.total === 0 && p.perWeek === 0 && p.level === 0 && p.short === 10 && p.over === 0)).toBe(true);
  });
});

describe('phaseLevel：0.1 単位の値（10 倍した整数）で段を決める', () => {
  test.each([
    [0, 0], [1, 1], [49, 1], [50, 2], [99, 2], [100, 3], [149, 3], [150, 4], [200, 4], [201, 5], [450, 5],
  ])('%i（週 %f 倍）→ %i 段', (tenths, level) => {
    expect(phaseLevel(tenths)).toBe(level);
  });

  test('丸めたあとで決める：端の値', () => {
    // 28 日（weeks 4）：セット数 × 2.5 が 0.1 単位の値
    const w = { kind: 'recent' as const, title: '', label: '', from: '2026-10-20', to: '2026-11-16', rehab: [] };
    const at = (n: number) => phasePartVolume(chestRows('2026-11-05', n), nameOf, w).parts[0];
    expect(at(2)).toMatchObject({ perWeek: 0.5, level: 1 });
    expect(at(19)).toMatchObject({ perWeek: 4.8, level: 1 }); // 4.75 → 4.8
    expect(at(20)).toMatchObject({ perWeek: 5, level: 2 });
    expect(at(40)).toMatchObject({ perWeek: 10, level: 3, short: 0 });
    expect(at(60)).toMatchObject({ perWeek: 15, level: 4 });
    expect(at(80)).toMatchObject({ perWeek: 20, level: 4, over: 0 });
    expect(at(81)).toMatchObject({ perWeek: 20.3, level: 5, over: 0.3 });
    // 長い期間：1 セットが週 0.0 に丸まる → 0 段（セットはあるが週 0）
    const long = phasePartVolume(chestRows('2026-11-05', 1), nameOf, { ...w, from: '2026-05-01' }).parts[0];
    expect(long).toMatchObject({ total: 1, perWeek: 0, level: 0 });
  });
});

describe('phaseVolumeLabel・heroVolumeCaption：セット数が主で、目安の言葉は使わない', () => {
  const w = { kind: 'phase' as const, title: '増量 8週の部位', label: '増量 8週', from: '2026-11-02', to: '2026-11-16', rehab: [] };
  const v = phasePartVolume([...chestRows('2026-11-05', 16), ...rows('2026-11-05', 'legs', 60)], nameOf, w);

  test('読み上げ：期間・部位ごとのセット数と週あたり（整数）・ケガ。あと・目安は言わない', () => {
    const text = phaseVolumeLabel(v, new Set(['胸'] as const));
    expect(text).toBe(
      '増量 8週の部位、11月2日から11月16日のセット数。'
      + '胸 16 セット、週 8、ケガ。肩 0 セット、週 0。背中 0 セット、週 0。腕 0 セット、週 0。脚 60 セット、週 28。腹 0 セット、週 0',
    );
    for (const gone of ['あと', '目安', '少なめ']) expect(text).not.toContain(gone);
    expect(phaseVolumeLabel(phasePartVolume([], nameOf, w))).toContain('まだ記録がありません');
  });

  test('ヒーローの見出し：期間の名前と、部位ぜんぶの合計', () => {
    expect(phaseTotalSets(v)).toBe(76);
    expect(heroVolumeCaption(v)).toBe('増量 8週で 76セット');
    expect(heroVolumeCaption(phasePartVolume([], nameOf, { ...w, kind: 'recent', title: '直近4週の部位', label: '直近4週' }))).toBe('直近4週で 0セット');
  });

  test('行の文字：「23セット」と、四捨五入の「週18」', () => {
    expect(setsText(23)).toBe('23セット');
    expect([0, 0.4, 17.5, 18.4, 22.5].map(weekRoundedText)).toEqual(['週0', '週0', '週18', '週18', '週23']);
  });
});
