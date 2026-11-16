import { HERO_TAG_MAX, pickByMesh, pickByNames, recoveryCandidates, selectHeroTags, volumeCandidates } from '../heroTags';
import { phasePartVolume } from '../partVolume';
import { partRecoveries } from '../recoveryMap';
import type { TrainingSetRow } from '../training';

const NAMES: Record<string, string> = { chest: '胸', back: '背中', shoulder: '肩', legs: '脚', biceps: '上腕二頭筋', abs: '腹筋' };
const nameOf = (id: string) => NAMES[id] ?? '';
const rows = (date: string, part: string, n: number): TrainingSetRow[] =>
  Array.from({ length: n }, () => ({ date, exerciseId: 'e', bodyPartId: part, weightKg: 50, reps: 10 }));
const keys = (tags: { key: string }[]) => tags.map((t) => t.key);

describe('部位の量の札：目安（10〜20）から外れた部位だけ、外れ方が大きい順に 3 つまで', () => {
  // 7 日の期間（週あたり = セット数）：胸 12（目安内）、肩 3（あと7）、背中 24（多い 4）、腕 0（あと10）、脚 8（あと2）、腹 0（あと10）
  const w = { kind: 'phase' as const, title: '', from: '2026-11-10', to: '2026-11-16', rehab: [] };
  const data = [...rows('2026-11-12', 'chest', 12), ...rows('2026-11-12', 'shoulder', 3), ...rows('2026-11-12', 'back', 24), ...rows('2026-11-12', 'legs', 8)];
  const cands = volumeCandidates(phasePartVolume(data, nameOf, w));

  test('先頭は 3 つ：腕・腹（あと10。同じなら 6 軸の並び）、次に背中の 4 ではなく肩の 7', () => {
    const tags = selectHeroTags(cands, null);
    expect(keys(tags)).toEqual(['腕', '腹', '肩']);
    expect(tags.map((t) => t.spoken)).toEqual(['腕 週0（あと10）', '腹 週0（あと10）', '肩 週3.0（あと7）']);
    expect(tags.length).toBeLessThanOrEqual(HERO_TAG_MAX);
  });

  test('多い側：背中 24 は「多い」。外れ方の大きさで並ぶ（多い 4 は、あと2 より先）', () => {
    const only = cands.filter((c) => ['背中', '脚', '胸'].includes(c.tag.part));
    expect(selectHeroTags(only, null).map((t) => t.spoken)).toEqual(['背中 週24.0（多い）', '脚 週8.0（あと2）']);
  });

  test('押した部位は、先頭 3 つに入っていなくても足す（先頭 3 つのあとに 1 つ）。入っていれば足さない', () => {
    expect(keys(selectHeroTags(cands, '胸'))).toEqual(['腕', '腹', '肩', '胸']);
    expect(selectHeroTags(cands, '胸')[3].spoken).toBe('胸 週12.0（目安内）');
    expect(keys(selectHeroTags(cands, '背中'))).toEqual(['腕', '腹', '肩', '背中']);
    expect(keys(selectHeroTags(cands, '腹'))).toEqual(['腕', '腹', '肩']);
    expect(keys(selectHeroTags(cands, 'どこでもない'))).toEqual(['腕', '腹', '肩']);
  });

  test('どの部位も目安の中なら札なし。押したときだけ、その部位の札', () => {
    const inBand = cands.map((c) => ({ ...c, need: null }));
    expect(selectHeroTags(inBand, null)).toEqual([]);
    expect(keys(selectHeroTags(inBand, '脚'))).toEqual(['脚']);
  });

  test('小数のあと：週 8.5 は「あと1.5」', () => {
    const w28 = { ...w, from: '2026-10-20' };
    // 28 日：セット数 × 2.5 = 0.1 単位。34 セット → 8.5
    const c = volumeCandidates(phasePartVolume(rows('2026-11-12', 'chest', 34), nameOf, w28)).find((x) => x.tag.part === '胸')!;
    expect(c.tag.spoken).toBe('胸 週8.5（あと1.5）');
    expect(c.tag).toMatchObject({ lead: '胸', main: '週8.5', sub: 'あと1.5' });
  });
});

describe('回復の札：回復中の部位だけ、あと何日が長い順に 3 つまで', () => {
  const today = '2026-11-16';
  const names = ['胸', '肩', '背中', '脚', '上腕二頭筋', '腹筋'];
  // 胸（R=2）は今日 → あと3日、脚（R=4?）の回復日数は recoveryDaysFor による。前日の部位はあと日数が減る
  const data = [
    ...rows('2026-11-16', 'chest', 3), ...rows('2026-11-15', 'legs', 3), ...rows('2026-11-16', 'back', 3), ...rows('2026-11-16', 'abs', 3),
    ...rows('2026-11-01', 'shoulder', 3), // 古い → 回復済みか空いている
  ];
  const list = partRecoveries(data, nameOf, names, today);
  const cands = recoveryCandidates(list);

  test('回復中だけが先頭に出る。あと日数の大きい順、同じなら並びの順', () => {
    const recovering = list.filter((p) => p.remaining != null).sort((a, b) => b.remaining! - a.remaining!);
    expect(recovering.length).toBeGreaterThan(3);
    const tags = selectHeroTags(cands, null);
    expect(tags).toHaveLength(3);
    const expected = [...list].map((p, i) => ({ p, i })).filter(({ p }) => p.remaining != null)
      .sort((a, b) => b.p.remaining! - a.p.remaining! || a.i - b.i).slice(0, 3).map(({ p }) => p.name);
    expect(keys(tags)).toEqual(expected);
    for (const t of tags) expect(t.spoken).toMatch(/^.+ あと\d+日$/);
  });

  test('回復済み・空いている・まだの部位は、押したときだけ出る（言い方は回復マップの札と同じ）', () => {
    const done = list.find((p) => p.remaining == null && p.last != null)!;
    expect(keys(selectHeroTags(cands, done.name)).at(-1)).toBe(done.name);
    expect(selectHeroTags(cands, done.name).at(-1)!.main).toMatch(/^(回復済み|空いて\d+日)$/);
    const never = recoveryCandidates(partRecoveries([], nameOf, ['胸'], today));
    expect(selectHeroTags(never, null)).toEqual([]);
    expect(selectHeroTags(never, '胸')[0].spoken).toBe('胸 まだ');
  });

  test('みんな回復済みなら札なし', () => {
    const rested = recoveryCandidates(partRecoveries(rows('2026-10-01', 'chest', 3), nameOf, ['胸', '肩'], today));
    expect(selectHeroTags(rested, null)).toEqual([]);
  });
});

describe('押した所から部位を選ぶ', () => {
  const w = { kind: 'phase' as const, title: '', from: '2026-11-10', to: '2026-11-16', rehab: [] };
  const vol = volumeCandidates(phasePartVolume([], nameOf, w));
  const rec = recoveryCandidates(partRecoveries([], nameOf, ['胸', '上腕二頭筋', '脚'], '2026-11-16'));

  test('3D の部品：回復は部位の部品、部位の量は軸の部品（腕は二頭筋・三頭筋）', () => {
    expect(pickByMesh(rec, 'pec_r')).toBe('胸');
    expect(pickByMesh(rec, 'biceps_l')).toBe('上腕二頭筋');
    expect(pickByMesh(vol, 'triceps_r')).toBe('腕');
    expect(pickByMesh(vol, 'quad_l')).toBe('脚');
    expect(pickByMesh(vol, 'abs')).toBe('腹');
    expect(pickByMesh(vol, 'skin')).toBeNull();
    expect(pickByMesh(vol, null)).toBeNull();
  });

  test('2D の図：押した点のまわりの部位の名前。部位の量は名前が属する軸', () => {
    expect(pickByNames(rec, ['脚', '胸'])).toBe('胸');
    expect(pickByNames(vol, ['上腕二頭筋'])).toBe('腕');
    expect(pickByNames(vol, ['腹筋', '胸'])).toBe('胸');
    expect(pickByNames(vol, [])).toBeNull();
    expect(pickByNames(vol, ['首'])).toBeNull();
  });
});
