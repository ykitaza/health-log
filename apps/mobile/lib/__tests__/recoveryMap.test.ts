import { readFileSync } from 'fs';
import { join } from 'path';
import type { Injury } from '@/db/repositories/injuries';
import { SEED_BODY_PARTS } from '@/db/seed';
import { ALL_PARTS, anchorFor, boxOf, jointAnchor, layoutCallouts, projectFront } from '@/lib/bodyModel';
import { muscleFigureFor } from '@/lib/muscleFigure';
import { contrastRatio } from '@/lib/contrast';
import {
  DEFAULT_RECOVERY_DAYS, fixingOn, IDLE_AFTER_DAYS, IDLE_FILL, IDLE_GRAY, idleMeshes, INJURY_RED, injuriesForPart, isIdle, leadInjury, LOAD_ORANGE, LOAD_YELLOW, muscleFills, partOfMesh, PartRecovery, partRecoveries,
  recoveryAnchor, recoveryCalloutAnchor, recoveryColor, recoveryDaysFor, recoveryLevel, recoveryLevels, recoveryMeshesFor, recoveryMusclesFor, recoveryShortText,
  recoveryStatusText, remainingDays, restColor, REST_FILL, REST_GREEN, suggestRecovered,
} from '@/lib/recoveryMap';
import { colors, toneColors } from '@/theme';
import type { TrainingSetRow } from '@/lib/training';

/** GLB の部品の名前（皮膚を除く） */
function glbParts(): string[] {
  const b = readFileSync(join(__dirname, '../../assets/models/body.glb'));
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()) as { meshes: { name: string }[] };
  return json.meshes.map((m) => m.name).filter((n) => n !== 'skin');
}

const row = (date: string, bodyPartId: string): TrainingSetRow => ({ date, bodyPartId, exerciseId: `ex-${bodyPartId}`, weightKg: 50, reps: 10 });
const name = (id: string) => ({ c: '胸', b: '背中', s: '肩', l: '脚', bi: '上腕二頭筋', tri: '上腕三頭筋', ab: '腹筋', x: '握力' } as Record<string, string>)[id] ?? '';
const injury = (o: Partial<Injury>): Injury => ({
  id: 'i', occurredOn: '2026-11-01', site: 'chest', side: 'right', exerciseId: null, exerciseName: null, phase: '', symptom: '', cause: '', fix: '',
  status: 'fixing', fixedOn: null, createdAt: '', reviewCount: 0, lastReview: null, ...o,
});

describe('回復マップの部位と部品', () => {
  test('初期の部位はどれも GLB にある部品を光らせる。GLB の筋肉の部品はどれかの部位にあたる', () => {
    const glb = new Set(glbParts());
    const used = new Set<string>();
    for (const p of SEED_BODY_PARTS) {
      const meshes = recoveryMeshesFor(p.name);
      expect(meshes.length).toBeGreaterThan(0);
      for (const m of meshes) { expect(glb.has(m)).toBe(true); used.add(m); }
    }
    expect([...glb].filter((m) => !used.has(m))).toEqual([]);
    // ケガの画面の部品（三角筋の中部を除く）も、すべて回復マップで光る
    for (const m of ALL_PARTS) expect(used.has(m)).toBe(true);
  });

  test('2D の図と同じ考え方：2D で塗る筋肉は 3D でも光らせる（上腕三頭筋だけは 2D の前の図にないので三頭筋）', () => {
    const head: Record<string, string> = {
      pecs: 'pec', trapezius: 'trap', lats: 'lat', erectorsUpper: 'erector_up', erectorsLower: 'erector_low', deltoid: 'delt_front',
      quads: 'quad', shins: 'shin', biceps: 'biceps', forearm: 'forearm', abs: 'abs', obliques: 'oblique',
    };
    for (const p of ['胸', '背中', '肩', '脚', '上腕二頭筋', '腕', '腹筋', '腹']) {
      for (const m of muscleFigureFor(p).muscles) expect(recoveryMeshesFor(p).some((x) => x.startsWith(head[m]))).toBe(true);
    }
    expect(recoveryMeshesFor('上腕三頭筋')).toEqual(['triceps_r', 'triceps_l', 'forearm_r', 'forearm_l']);
    expect(recoveryMeshesFor('腹筋')).toEqual(['abs', 'oblique_r', 'oblique_l']);
    expect(recoveryMeshesFor(' 胸 ')).toEqual(['pec_r', 'pec_l']);
    expect(recoveryMeshesFor('握力')).toEqual([]);
  });
});

describe('部位ごとの回復の日数と明るさ', () => {
  test('回復の日数：腹筋 1日、腕・肩・胸 2日、背中・脚 3日、知らない部位 2日', () => {
    expect(['腹筋', '腹', '上腕二頭筋', '上腕三頭筋', '腕', '肩', '胸', '背中', '脚', '握力', ' 胸 '].map(recoveryDaysFor))
      .toEqual([1, 1, 2, 2, 2, 2, 2, 3, 3, DEFAULT_RECOVERY_DAYS, 2]);
  });

  test('明るさ k = 1 − d ÷ (R+1)。R 日目を過ぎたら 0（回復済み）。一度もなければ 0', () => {
    // 胸（R=2）：鍛えた日 1、翌日 2/3、2日目 1/3、3日目 0
    [1, 2 / 3, 1 / 3, 0, 0].forEach((k, i) => expect(recoveryLevel([0, 1, 2, 3, 10][i], 2)).toBeCloseTo(k));
    // 腹筋（R=1）：1、1/2、0
    expect([0, 1, 2].map((d) => recoveryLevel(d, 1))).toEqual([1, 0.5, 0]);
    // 背中（R=3）：1、3/4、1/2、1/4、0
    expect([0, 1, 2, 3, 4].map((d) => recoveryLevel(d, 3))).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(recoveryLevel(null, 2)).toBe(0);
    expect(recoveryLevel(-1, 2)).toBe(1);
  });

  test('回復の残りと状態の文字：回復中は「回復中 あと N日」、R+1 日目から「回復済み」、一度もなければ「まだ」', () => {
    expect([0, 1, 2, 3].map((d) => remainingDays(d, 2))).toEqual([3, 2, 1, null]);
    expect(remainingDays(null, 2)).toBeNull();
    expect(recoveryStatusText({ last: '2026-11-12', days: 1, remaining: 1, idle: false })).toBe('回復中 あと1日');
    expect(recoveryStatusText({ last: '2026-11-01', days: 3, remaining: null, idle: false })).toBe('回復済み');
    expect(recoveryStatusText({ last: '2026-11-01', days: 12, remaining: null, idle: true })).toBe('空いて12日');
    expect(recoveryStatusText({ last: null, days: null, remaining: null, idle: false })).toBe('まだ');
    // 札の短い形
    expect(recoveryShortText({ last: '2026-11-12', days: 1, remaining: 1, idle: false })).toBe('あと1日');
    expect(recoveryShortText({ last: '2026-11-01', days: 3, remaining: null, idle: false })).toBe('回復済み');
    expect(recoveryShortText({ last: '2026-11-01', days: 12, remaining: null, idle: true })).toBe('空いて12日');
    expect(recoveryShortText({ last: null, days: null, remaining: null, idle: false })).toBe('まだ');
  });

  test('回復済みの期限：回復済みになった日（R+1 日目）を 0 日目として 7 日目（R+8 日目）までが回復済み、8 日目（R+9 日目）から空いている', () => {
    expect(IDLE_AFTER_DAYS).toBe(7);
    // 腹筋（R=1）は 2〜9 日目が回復済み、10 日目から。胸（R=2）は 3〜10、11 から。背中（R=3）は 4〜11、12 から
    for (const [R, first] of [[1, 10], [2, 11], [3, 12]]) {
      expect(isIdle(R + 1, R)).toBe(false);
      expect(isIdle(first - 1, R)).toBe(false);
      expect(isIdle(first, R)).toBe(true);
      expect(remainingDays(first - 1, R)).toBeNull();
    }
    expect(isIdle(null, 2)).toBe(false);
    expect(isIdle(0, 2)).toBe(false);
    expect(isIdle(90, 2)).toBe(true);
    // 部位ごと：胸は 10 日前まで回復済み、11 日前から空いている。一度もない肩は空いているでなく「まだ」
    const at = (d: string) => partRecoveries([row(d, 'c')], name, ['胸', '肩'], '2026-11-13');
    expect(at('2026-11-03')[0]).toMatchObject({ days: 10, remaining: null, idle: false, level: 0 });
    const [chest, shoulder] = at('2026-11-02');
    expect(chest).toMatchObject({ days: 11, remaining: null, idle: true, level: 0 });
    expect(recoveryStatusText(chest)).toBe('空いて11日');
    expect(shoulder).toMatchObject({ last: null, idle: false });
    expect(recoveryStatusText(shoulder)).toBe('まだ');
  });

  test('部位ごとの最後の日・日数・回復・2週間のセット数。その日より後は見ない。主な部位でなくても1セットで数える', () => {
    const rows = [
      row('2026-10-20', 'c'), // 2週間より前
      row('2026-11-01', 'c'), row('2026-11-10', 'c'), row('2026-11-10', 'c'),
      row('2026-11-12', 'tri'),
      row('2026-11-12', 'b'),
      row('2026-11-14', 'b'), // その日より後
      row('2026-11-05', 'x'),
    ];
    const list = partRecoveries(rows, name, ['胸', '背中', '肩', '上腕三頭筋', '握力'], '2026-11-13');
    expect(list.map((p) => p.name)).toEqual(['胸', '背中', '肩', '上腕三頭筋']);
    // 胸は 3日前（R=2）：回復済み
    expect(list[0]).toMatchObject({ last: '2026-11-10', days: 3, sets: 3, recoveryDays: 2, remaining: null, level: 0 });
    // 背中は昨日（R=3）：あと3日
    expect(list[1]).toMatchObject({ last: '2026-11-12', days: 1, recoveryDays: 3, remaining: 3, level: 0.75 });
    expect(list[2]).toMatchObject({ last: null, days: null, sets: 0, remaining: null, level: 0 });
    expect(list[3]).toMatchObject({ last: '2026-11-12', days: 1, sets: 1, remaining: 2 });
    expect(list[3].level).toBeCloseTo(2 / 3);

    // 前腕は二頭筋・三頭筋の両方にある：明るいほう。押したら最後の日の新しい部位
    const withBi = partRecoveries([...rows, row('2026-11-13', 'bi')], name, ['上腕二頭筋', '上腕三頭筋'], '2026-11-13');
    const levels = recoveryLevels(withBi);
    expect(levels.forearm_l).toBe(1);
    expect(levels.triceps_r).toBeCloseTo(2 / 3);
    expect(partOfMesh('forearm_r', withBi)?.name).toBe('上腕二頭筋');
    expect(partOfMesh('triceps_r', withBi)?.name).toBe('上腕三頭筋');
    expect(partOfMesh('pec_r', withBi)).toBeNull();
    expect(recoveryLevels(list).pec_r).toBe(0);
  });
});

describe('注釈の付け根', () => {
  test('初期の部位はどれも付け根がある。体の中（高さ 0〜1.8m、幅 ±0.35m）。前の部位は前の面、後ろの部位は後ろの面', () => {
    for (const p of SEED_BODY_PARTS) {
      const at = recoveryAnchor(p.name)!;
      expect(at).not.toBeNull();
      expect(at.anchor[1]).toBeGreaterThan(0); expect(at.anchor[1]).toBeLessThan(1.8);
      expect(Math.abs(at.anchor[0])).toBeLessThan(0.35);
    }
    expect(recoveryAnchor('胸')!.facing).toBe('front');
    expect(recoveryAnchor('胸')!.anchor[2]).toBeGreaterThan(0.1);
    expect(recoveryAnchor('背中')!.facing).toBe('back');
    expect(recoveryAnchor('背中')!.anchor[2]).toBeLessThan(-0.1);
    expect(recoveryAnchor('握力')).toBeNull();
  });

  test('札が左右に分かれる：胸・二頭筋・腹筋は画面の左、肩・三頭筋・背中・脚は画面の右（正面から見て）', () => {
    const w = 360, h = 340;
    const side = (p: string) => (projectFront(recoveryAnchor(p)!.anchor, w, h).x < w / 2 ? 'left' : 'right');
    expect(['胸', '上腕二頭筋'].map(side)).toEqual(['left', 'left']);
    expect(['肩', '上腕三頭筋', '背中', '脚'].map(side)).toEqual(['right', 'right', 'right', 'right']);
    // 腹筋はまん中：前の部位なので左（layoutCallouts の決まり）
    const abs = layoutCallouts([{ id: 'abs', ...recoveryAnchor('腹筋')!, fixing: false, occurredOn: '' }], w, h, { perSide: 3, height: 52 });
    expect(abs[0].side).toBe('left');
  });

  test('左右それぞれ3つまで。ケガのある部位を先に、最後に鍛えた日の新しい順', () => {
    const items = ['胸', '上腕二頭筋', '腹筋', '腕'].map((p, i) => ({ id: p, ...recoveryAnchor(p)!, fixing: p === '腕', occurredOn: `2026-11-1${i}` }));
    const places = layoutCallouts(items, 360, 340, { perSide: 3, height: 52 });
    expect(places.map((p) => p.id).sort()).toEqual(['上腕二頭筋', '腕', '腹筋'].sort());
  });
});

describe('回復マップのケガ', () => {
  test('その日に直している途中だったもの。直せたものは出さない（その日より後に直せたものは、その日は途中）', () => {
    const list = [
      injury({ id: 'a' }),
      injury({ id: 'b', status: 'fixed', fixedOn: '2026-11-05' }),
      injury({ id: 'c', status: 'fixed', fixedOn: '2026-11-20' }),
      injury({ id: 'd', occurredOn: '2026-11-15' }),
    ];
    expect(fixingOn(list, '2026-11-13').map((i) => i.id)).toEqual(['a', 'c']);
    expect(fixingOn(list, '2026-11-21').map((i) => i.id)).toEqual(['a', 'd']);
  });

  test('部位にかかわるケガ：部品が重なるもの（左右は問わない）だけ。関節は近い筋肉の部位', () => {
    const [chest, legs, shoulder, back, tri] = partRecoveries([], name, ['胸', '脚', '肩', '背中', '上腕三頭筋'], '2026-11-13');
    const list = [
      injury({ id: 'pec', site: 'chest', side: 'left' }),
      injury({ id: 'knee', site: 'knee', side: 'right' }),
      injury({ id: 'neck', site: 'neck', side: null }),
      injury({ id: 'sj', site: 'shoulder_joint', side: 'right' }),
      injury({ id: 'waist', site: 'waist', side: null }),
      injury({ id: 'elbow', site: 'elbow', side: 'left' }),
    ];
    expect(injuriesForPart(chest, list).map((i) => i.id)).toEqual(['pec']);
    expect(injuriesForPart(legs, list).map((i) => i.id)).toEqual(['knee']);
    expect(injuriesForPart(shoulder, list).map((i) => i.id)).toEqual(['sj']);
    expect(injuriesForPart(back, list).map((i) => i.id)).toEqual(['neck', 'waist']);
    expect(injuriesForPart(tri, list).map((i) => i.id)).toEqual(['elbow']);
  });

  test('痛めた種目では結ばない：ベンチプレスで痛めた右肩の関節は肩（胸でない）、スクワットで痛めた腰の筋肉は背中（脚でない）', () => {
    const [chest, legs, shoulder, back] = partRecoveries([], name, ['胸', '脚', '肩', '背中'], '2026-11-13');
    const list = [
      injury({ id: 'bench', site: 'shoulder_joint', side: 'right', exerciseId: 'bench', exerciseName: 'ベンチプレス' }),
      injury({ id: 'squat', site: 'lower_back', side: 'left', exerciseId: 'squat', exerciseName: 'スクワット' }),
    ];
    expect(injuriesForPart(chest, list)).toEqual([]);
    expect(injuriesForPart(legs, list)).toEqual([]);
    expect(injuriesForPart(shoulder, list).map((i) => i.id)).toEqual(['bench']);
    expect(injuriesForPart(back, list).map((i) => i.id)).toEqual(['squat']);
  });
});

describe('ケガのある部位の札の付け根（#205）', () => {
  const [back, shoulder, chest] = partRecoveries([], name, ['背中', '肩', '胸'], '2026-11-13');

  test('腰の筋肉のケガがある背中は、赤く光る腰の起立筋の囲みのまん中（背中の代表点でない）。後ろの面', () => {
    const hurt = injuriesForPart(back, [injury({ id: 'lb', site: 'lower_back', side: 'right' })]);
    const at = recoveryCalloutAnchor('背中', hurt)!;
    const [lo, hi] = boxOf('erector_low_r')!;
    expect(at.facing).toBe('back');
    expect(at.anchor[0]).toBeCloseTo((lo[0] + hi[0]) / 2);
    expect(at.anchor[1]).toBeCloseTo((lo[1] + hi[1]) / 2);
    expect(at.anchor[2]).toBeCloseTo(lo[2]);
    expect(at.anchor).toEqual(anchorFor('lower_back', 'right'));
    // 背中の代表点（僧帽筋〜起立筋のまん中）より下
    expect(at.anchor[1]).toBeLessThan(recoveryAnchor('背中')!.anchor[1] - 0.1);
  });

  test('関節のケガ（右肩の関節）は関節の点', () => {
    const hurt = injuriesForPart(shoulder, [injury({ id: 'sj', site: 'shoulder_joint', side: 'right' })]);
    expect(recoveryCalloutAnchor('肩', hurt)).toEqual({ anchor: jointAnchor('shoulder_joint', 'right'), facing: 'front' });
  });

  test('ケガが複数なら直している途中のものを優先、なければ先頭', () => {
    const neck = injury({ id: 'neck', site: 'neck', side: null, status: 'fixed', fixedOn: '2026-11-20' });
    const waist = injury({ id: 'waist', site: 'waist', side: null });
    const lats = injury({ id: 'lats', site: 'lats', side: 'left', status: 'fixed', fixedOn: '2026-11-20' });
    expect(leadInjury([neck, waist])!.id).toBe('waist');
    expect(recoveryCalloutAnchor('背中', [neck, waist])!.anchor).toEqual(jointAnchor('waist', null));
    expect(leadInjury([lats, neck])!.id).toBe('lats');
    expect(recoveryCalloutAnchor('背中', [lats, neck])!.anchor).toEqual(anchorFor('lats', 'left'));
    expect(leadInjury([])).toBeNull();
  });

  test('ケガのない部位と知らない部位は今のまま', () => {
    expect(recoveryCalloutAnchor('胸', injuriesForPart(chest, []))).toEqual(recoveryAnchor('胸'));
    expect(recoveryCalloutAnchor('背中', [])).toEqual(recoveryAnchor('背中'));
    expect(recoveryCalloutAnchor('握力', [injury({ site: 'chest' })])).toBeNull();
  });
});

describe('すすめる部位（suggestRecovered）', () => {
  const none = () => false;
  test('空いている部位もすすめる（いちばん長く空いている部位）', () => {
    // 11-13 の時点：背中は 10-01（空いている）、脚は 11-09（回復済み）
    const list = partRecoveries([row('2026-10-01', 'b'), row('2026-11-09', 'l')], name, ['背中', '脚'], '2026-11-13');
    expect(list[0].idle).toBe(true);
    expect(suggestRecovered(list, none)?.name).toBe('背中');
  });

  test('回復済みのうち、最後に鍛えた日がいちばん古い部位。回復中・一度もない部位はすすめない', () => {
    // 11-13 の時点：胸は 11-12（回復中）、背中は 11-08（5日前・回復済み）、脚は 11-09（回復済み）、肩は一度もない
    const list = partRecoveries([row('2026-11-12', 'c'), row('2026-11-08', 'b'), row('2026-11-09', 'l')], name, ['胸', '背中', '脚', '肩'], '2026-11-13');
    expect(suggestRecovered(list, none)?.name).toBe('背中');
  });

  test('回復の日数で数える：背中（3日）は鍛えた日から 3日目まで回復中なので、すすめない。腹筋（1日）は 2日目から', () => {
    const list = partRecoveries([row('2026-11-10', 'b'), row('2026-11-11', 'ab')], name, ['背中', '腹筋'], '2026-11-13');
    expect(list.map((p) => p.remaining)).toEqual([1, null]);
    expect(suggestRecovered(list, none)?.name).toBe('腹筋');
  });

  test('背中・脚・胸だけでなく、全部の部位から選ぶ。同じ日なら並びの先', () => {
    const list = partRecoveries([row('2026-11-01', 'bi'), row('2026-11-01', 'tri'), row('2026-11-05', 'b')], name, ['背中', '上腕三頭筋', '上腕二頭筋'], '2026-11-13');
    expect(suggestRecovered(list, none)?.name).toBe('上腕三頭筋');
  });

  test('直している途中のケガがある部位はすすめない。どれも回復中か一度もなければ null', () => {
    const list = partRecoveries([row('2026-11-01', 'b'), row('2026-11-05', 'l')], name, ['背中', '脚'], '2026-11-13');
    expect(suggestRecovered(list, (p: PartRecovery) => p.name === '背中')?.name).toBe('脚');
    expect(suggestRecovered(partRecoveries([row('2026-11-13', 'c')], name, ['胸', '肩'], '2026-11-13'), none)).toBeNull();
  });
});

describe('回復マップの色（緑・暖色・赤の3つと、灰色）', () => {
  const hsl = (c: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s: d === 0 ? 0 : d / (1 - Math.abs(max + min - 1)), l: (max + min) / 2 };
  };

  test('明るさ 0 は回復済みの緑（アプリのアクセント）、0.25 は黄、0.75 からは橙', () => {
    expect(recoveryColor(0)).toBe(REST_GREEN);
    expect(REST_GREEN).toBe(colors.accent);
    expect(recoveryColor(-1)).toBe(REST_GREEN);
    expect(recoveryColor(0.25)).toBe(LOAD_YELLOW);
    expect(recoveryColor(0.75)).toBe(LOAD_ORANGE);
    expect(recoveryColor(1)).toBe(LOAD_ORANGE);
  });

  test('回復中の色は、鍛えた日ほど橙（色相が小さい）、回復が近いほど黄。間は濁らない（鮮やかさ 70% 以上）', () => {
    for (const R of [1, 2, 3]) {
      const hues = Array.from({ length: R + 1 }, (_, d) => hsl(recoveryColor(recoveryLevel(d, R))));
      for (const c of hues) { expect(c.s).toBeGreaterThan(0.7); expect(c.h).toBeLessThanOrEqual(50); }
      for (let i = 1; i < hues.length; i++) expect(hues[i].h).toBeGreaterThanOrEqual(hues[i - 1].h);
    }
    // 胸（R=2）：鍛えた日と翌日は橙寄り（色相 35 未満）、2日目は黄寄り
    expect(hsl(recoveryColor(recoveryLevel(1, 2))).h).toBeLessThan(35);
    expect(hsl(recoveryColor(recoveryLevel(2, 2))).h).toBeGreaterThan(38);
    // 緑と黄の間（理屈の上だけの明るさ）も、色相を回すので濁らない
    expect(hsl(recoveryColor(0.12)).s).toBeGreaterThan(0.6);
  });

  test('ケガの赤は橙・ケガの画面の琥珀色と別の色。文字に使う色はカードと画面の背景に 4.5:1 以上', () => {
    expect(INJURY_RED).not.toBe(LOAD_ORANGE);
    expect(INJURY_RED).not.toBe(toneColors.caution.accent);
    for (const c of [INJURY_RED, LOAD_ORANGE, LOAD_YELLOW, REST_GREEN]) {
      expect(contrastRatio(c, colors.card)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c, colors.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('2D の図の筋肉は 3D の部品と同じ範囲：脚はもも裏・お尻・ふくらはぎも、上腕三頭筋は後ろの三頭筋', () => {
    expect(recoveryMusclesFor('脚')).toEqual(['quads', 'hamstrings', 'glutes', 'calves', 'shins']);
    expect(recoveryMusclesFor('上腕三頭筋')).toEqual(['triceps', 'forearm']);
    expect(recoveryMusclesFor('肩')).toEqual(['deltoid']);
    const fills = muscleFills(partRecoveries([row('2026-11-13', 'tri'), row('2026-11-13', 'l')], name, ['上腕三頭筋', '上腕二頭筋', '脚'], '2026-11-13'));
    expect([fills.triceps, fills.hamstrings, fills.calves]).toEqual([LOAD_ORANGE, LOAD_ORANGE, LOAD_ORANGE]);
    // 二頭筋（まだ）は灰色
    expect(fills.biceps).toBe(IDLE_FILL);
  });

  test('2D の図：回復済みの筋肉は控えめな緑、回復中の筋肉は明るさの色、空いている・まだの筋肉は灰色（2D の図の対応で）', () => {
    // 胸は今日（回復中）、脚は 11-09（回復済み）、肩は 10-01（空いている）、背中は一度もない
    const list = partRecoveries([row('2026-11-13', 'c'), row('2026-11-09', 'l'), row('2026-10-01', 's')], name, ['胸', '脚', '肩', '背中'], '2026-11-13');
    const fills = muscleFills(list);
    expect(fills.pecs).toBe(LOAD_ORANGE);
    expect(fills.quads).toBe(REST_FILL);
    expect(fills.deltoid).toBe(IDLE_FILL);
    expect(fills.lats).toBe(IDLE_FILL);
    // どの部位にもない筋肉は今までどおり控えめな緑
    expect(fills.biceps).toBe(REST_FILL);
    expect(REST_FILL).toBe(colors.accentMuted);
    expect(IDLE_FILL).not.toBe(REST_FILL);
  });

  test('いくつかの部位にある筋肉・部品（前腕）：回復中 → 回復済み → 空いている・まだの順に先', () => {
    // 二頭筋は 11-10（回復済み）、三頭筋は 10-01（空いている）
    const list = partRecoveries([row('2026-11-10', 'bi'), row('2026-10-01', 'tri')], name, ['上腕二頭筋', '上腕三頭筋'], '2026-11-13');
    const fills = muscleFills(list);
    expect([fills.forearm, fills.biceps, fills.triceps]).toEqual([REST_FILL, REST_FILL, IDLE_FILL]);
    // 3D：前腕は回復済みの二頭筋にもあるので灰色にしない
    expect(idleMeshes(list).sort()).toEqual(['triceps_l', 'triceps_r']);
    // 一度もない部位の部品も灰色
    expect(idleMeshes(partRecoveries([row('2026-11-13', 'c')], name, ['胸', '腹筋'], '2026-11-13'))).toEqual(['abs', 'oblique_r', 'oblique_l']);
  });

  test('空いている・まだの色は色相のない灰色（色相は増やさない）。回復済みの緑と別', () => {
    expect(hsl(IDLE_GRAY).s).toBeLessThan(0.15);
    expect(hsl(IDLE_FILL).s).toBeLessThan(0.15);
    expect(restColor({ last: '2026-11-10', idle: false })).toBe(REST_GREEN);
    expect(restColor({ last: '2026-10-01', idle: true })).toBe(IDLE_GRAY);
    expect(restColor({ last: null, idle: false })).toBe(IDLE_GRAY);
  });
});
