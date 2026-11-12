import { readFileSync } from 'fs';
import { join } from 'path';
import type { Injury } from '@/db/repositories/injuries';
import { SEED_BODY_PARTS } from '@/db/seed';
import { ALL_PARTS } from '@/lib/bodyModel';
import { muscleFigureFor } from '@/lib/muscleFigure';
import { contrastRatio } from '@/lib/contrast';
import {
  fixingOn, INJURY_RED, injuriesForPart, LOAD_ORANGE, muscleFills, partOfMesh, partRecoveries, recoveryColor, recoveryLevel, recoveryLevels,
  recoveryMeshesFor, REST_BLUE, REST_BLUE_FILL,
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

describe('回復の光の明るさ', () => {
  test('今日・昨日が 1、1日ごとに 1/7 ずつ下がり、8日目で 0。一度もなければ 0', () => {
    expect(recoveryLevel(0)).toBe(1);
    expect(recoveryLevel(1)).toBe(1);
    expect(recoveryLevel(2)).toBeCloseTo(6 / 7);
    expect(recoveryLevel(4)).toBeCloseTo(4 / 7);
    expect(recoveryLevel(7)).toBeCloseTo(1 / 7);
    expect(recoveryLevel(8)).toBe(0);
    expect(recoveryLevel(30)).toBe(0);
    expect(recoveryLevel(null)).toBe(0);
  });

  test('部位ごとの最後の日・日数・2週間のセット数。その日より後は見ない。主な部位でなくても1セットで数える', () => {
    const rows = [
      row('2026-10-20', 'c'), // 2週間より前
      row('2026-11-01', 'c'), row('2026-11-10', 'c'), row('2026-11-10', 'c'),
      row('2026-11-12', 'tri'),
      row('2026-11-14', 'b'), // その日より後
      row('2026-11-05', 'x'),
    ];
    const list = partRecoveries(rows, name, ['胸', '背中', '肩', '上腕三頭筋', '握力'], '2026-11-13');
    expect(list.map((p) => p.name)).toEqual(['胸', '背中', '肩', '上腕三頭筋']);
    const chest = list[0];
    expect(chest).toMatchObject({ last: '2026-11-10', days: 3, sets: 3 });
    expect(chest.level).toBeCloseTo(5 / 7);
    expect(list[1]).toMatchObject({ last: null, days: null, sets: 0, level: 0 });
    expect(list[3]).toMatchObject({ last: '2026-11-12', days: 1, sets: 1, level: 1 });

    // 前腕は二頭筋・三頭筋の両方にある：明るいほう。押したら最後の日の新しい部位
    const levels = recoveryLevels(list);
    expect(levels.forearm_l).toBe(1);
    expect(levels.pec_r).toBeCloseTo(5 / 7);
    expect(levels.trap_r).toBe(0);
    const withBi = partRecoveries([...rows, row('2026-11-08', 'bi')], name, ['上腕二頭筋', '上腕三頭筋'], '2026-11-13');
    expect(partOfMesh('forearm_r', withBi)?.name).toBe('上腕三頭筋');
    expect(partOfMesh('biceps_r', withBi)?.name).toBe('上腕二頭筋');
    expect(partOfMesh('pec_r', withBi)).toBeNull();
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

  test('部位にかかわるケガ：部品が重なるもの（左右は問わない）か、痛めた種目がその部位のもの', () => {
    const [chest, legs] = partRecoveries([], name, ['胸', '脚'], '2026-11-13');
    const list = [
      injury({ id: 'pec', site: 'chest', side: 'left' }),
      injury({ id: 'knee', site: 'knee', side: 'right', exerciseId: 'squat' }),
      injury({ id: 'neck', site: 'neck', side: null }),
    ];
    const partOf = (id: string) => (id === 'squat' ? '脚' : null);
    expect(injuriesForPart(chest, list, partOf).map((i) => i.id)).toEqual(['pec']);
    expect(injuriesForPart(legs, list, partOf).map((i) => i.id)).toEqual(['knee']);
  });
});

describe('回復マップの色', () => {
  const hsl = (c: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return { s: max === min ? 0 : (max - min) / (1 - Math.abs(max + min - 1)), l: (max + min) / 2 };
  };

  test('明るさ 0 は温存の青、1 は負荷の橙。間は薄い色と黄を通る（青と黄の間で濁らない）', () => {
    expect(recoveryColor(0)).toBe(REST_BLUE);
    expect(recoveryColor(-1)).toBe(REST_BLUE);
    expect(recoveryColor(1)).toBe(LOAD_ORANGE);
    expect(recoveryColor(2)).toBe(LOAD_ORANGE);
    expect(recoveryColor(0.6)).toBe('#F5C94A');
    // 鍛えた日からの日数ごとの色（今日・昨日の橙から、8日目で青）は、どれも暗く濁らない（明るさ 50% 以上か、鮮やかさ 60% 以上）
    for (let d = 0; d <= 8; d++) {
      const c = hsl(recoveryColor(recoveryLevel(d)));
      expect(c.l >= 0.5 || c.s >= 0.6).toBe(true);
    }
    // 2日目は橙寄り（赤 > 青）、6日目は青寄り
    const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    expect(rgb(recoveryColor(recoveryLevel(2)))[0]).toBeGreaterThan(rgb(recoveryColor(recoveryLevel(2)))[2]);
    expect(rgb(recoveryColor(recoveryLevel(7)))[2]).toBeGreaterThan(rgb(recoveryColor(recoveryLevel(7)))[0]);
  });

  test('ケガの赤は負荷の橙・ケガの画面の琥珀色と別の色。文字に使うケガの赤はカードと画面の背景に 4.5:1 以上', () => {
    expect(INJURY_RED).not.toBe(LOAD_ORANGE);
    expect(INJURY_RED).not.toBe(toneColors.caution.accent);
    expect(contrastRatio(INJURY_RED, colors.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(INJURY_RED, colors.bg)).toBeGreaterThanOrEqual(4.5);
    // 凡例の四角・ボタンの点（文字でないもの）は 3:1 以上
    for (const c of [REST_BLUE, LOAD_ORANGE, INJURY_RED]) expect(contrastRatio(c, colors.input)).toBeGreaterThanOrEqual(3);
  });

  test('2D の図：鍛えていない筋肉は温存の青、最近鍛えた筋肉は明るさの色（2D の図の対応で）', () => {
    const list = partRecoveries([row('2026-11-12', 'c'), row('2026-10-01', 'l')], name, ['胸', '脚', '背中'], '2026-11-13');
    const fills = muscleFills(list);
    expect(fills.pecs).toBe(LOAD_ORANGE);
    expect(fills.quads).toBe(REST_BLUE_FILL);
    expect(fills.lats).toBe(REST_BLUE_FILL);
    expect(fills.glutes).toBe(REST_BLUE_FILL);
  });
});
