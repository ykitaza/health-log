import { HERO_TAG_MAX, HERO_TAG_MAX_WITH_RECOVERED, pickByMesh, pickByNames, recoveryCandidates, selectHeroTags, volumeCandidates } from '../heroTags';
import { phasePartVolume } from '../partVolume';
import { partRecoveries } from '../recoveryMap';
import type { TrainingSetRow } from '../training';

const NAMES: Record<string, string> = { chest: '胸', back: '背中', shoulder: '肩', legs: '脚', biceps: '上腕二頭筋', abs: '腹筋' };
const nameOf = (id: string) => NAMES[id] ?? '';
const rows = (date: string, part: string, n: number): TrainingSetRow[] =>
  Array.from({ length: n }, () => ({ date, exerciseId: 'e', bodyPartId: part, weightKg: 50, reps: 10 }));
const keys = (tags: { key: string }[]) => tags.map((t) => t.key);

describe('部位の量の札：フェーズで多くやった部位を、セット数の合計の多い順に 3 つ（0 セットは出さない）', () => {
  // 期間の合計：胸 12、肩 3、背中 24、脚 8。腕・腹は 0
  const w = { kind: 'phase' as const, title: '', label: '', from: '2026-11-10', to: '2026-11-16', rehab: [] };
  const data = [...rows('2026-11-12', 'chest', 12), ...rows('2026-11-12', 'shoulder', 3), ...rows('2026-11-12', 'back', 24), ...rows('2026-11-12', 'legs', 8)];
  const cands = volumeCandidates(phasePartVolume(data, nameOf, w));

  test('先頭は 3 つ：背中 24、胸 12、脚 8。肩の 3 は入らない。札は部位の名前と「24セット」の 2 行（あと・目安は付けない）', () => {
    const tags = selectHeroTags(cands, null);
    expect(keys(tags)).toEqual(['背中', '胸', '脚']);
    expect(tags.map((t) => t.spoken)).toEqual(['背中 24セット', '胸 12セット', '脚 8セット']);
    expect(tags[0]).toMatchObject({ lead: '背中', main: '24セット', sub: '' });
    expect(tags.length).toBeLessThanOrEqual(HERO_TAG_MAX);
  });

  test('同じセット数なら 6 軸の並び（胸 肩 背中 腕 脚 腹）', () => {
    const tie = [...rows('2026-11-12', 'legs', 5), ...rows('2026-11-12', 'back', 5), ...rows('2026-11-12', 'shoulder', 5), ...rows('2026-11-12', 'abs', 5)];
    expect(keys(selectHeroTags(volumeCandidates(phasePartVolume(tie, nameOf, w)), null))).toEqual(['肩', '背中', '脚']);
  });

  test('0 セットの部位は出さない：やった部位が 2 つなら札も 2 つ。記録がなければ札なし', () => {
    const two = [...rows('2026-11-12', 'chest', 2), ...rows('2026-11-12', 'legs', 9)];
    expect(keys(selectHeroTags(volumeCandidates(phasePartVolume(two, nameOf, w)), null))).toEqual(['脚', '胸']);
    expect(selectHeroTags(volumeCandidates(phasePartVolume([], nameOf, w)), null)).toEqual([]);
  });

  test('押した部位は、先頭 3 つに入っていなくても足す（0 セットの腹も「腹 0セット」）。入っていれば足さない', () => {
    expect(keys(selectHeroTags(cands, '肩'))).toEqual(['背中', '胸', '脚', '肩']);
    expect(selectHeroTags(cands, '肩')[3].spoken).toBe('肩 3セット');
    expect(selectHeroTags(cands, '腹')[3].spoken).toBe('腹 0セット');
    expect(keys(selectHeroTags(cands, '背中'))).toEqual(['背中', '胸', '脚']);
    expect(keys(selectHeroTags(cands, 'どこでもない'))).toEqual(['背中', '胸', '脚']);
  });

  test('全期間の合計で数える：4 週に 100 セット入れても、札は「100セット」（週あたりではない）', () => {
    const w28 = { ...w, from: '2026-10-20' };
    const c = volumeCandidates(phasePartVolume(rows('2026-11-12', 'chest', 100), nameOf, w28)).find((x) => x.tag.part === '胸')!;
    expect(c.tag).toMatchObject({ lead: '胸', main: '100セット', sub: '', spoken: '胸 100セット' });
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

  test('みんな回復済みなら、回復済みの札が出る（言い方は回復マップの札と同じ「回復済み」）。空いている部位は出ない', () => {
    // 11/12 に鍛えた胸（R=2 → 回復済み）。11/1 に鍛えた肩は空いている
    const rested = recoveryCandidates(partRecoveries([...rows('2026-11-12', 'chest', 3), ...rows('2026-11-01', 'shoulder', 3)], nameOf, ['胸', '肩'], today));
    const tags = selectHeroTags(rested, null, HERO_TAG_MAX, HERO_TAG_MAX_WITH_RECOVERED);
    expect(tags.map((t) => t.spoken)).toEqual(['胸 回復済み']);
    expect(selectHeroTags(rested, null)).toHaveLength(1);
    expect(selectHeroTags(recoveryCandidates(partRecoveries(rows('2026-10-01', 'chest', 3), nameOf, ['胸'], today)), null, HERO_TAG_MAX, 4)).toEqual([]);
  });

  test('回復中が先、回復済みはそのあと：回復中 2 つ + 回復済み 2 つ。回復済みは最後に鍛えた日の新しい順で、全部で 4 つまで', () => {
    const names6 = ['胸', '肩', '背中', '脚', '上腕二頭筋', '腹筋'];
    const d = [
      ...rows('2026-11-16', 'chest', 1), ...rows('2026-11-16', 'back', 1), // 回復中
      ...rows('2026-11-12', 'shoulder', 1), ...rows('2026-11-13', 'biceps', 1), ...rows('2026-11-11', 'abs', 1), // 回復済み（腹筋は R=1 で回復済み）
    ];
    const c = recoveryCandidates(partRecoveries(d, nameOf, names6, today));
    const tags = selectHeroTags(c, null, HERO_TAG_MAX, HERO_TAG_MAX_WITH_RECOVERED);
    expect(tags).toHaveLength(HERO_TAG_MAX_WITH_RECOVERED);
    expect(keys(tags).slice(0, 2).sort()).toEqual(['背中', '胸']);
    expect(keys(tags).slice(2)).toEqual(['上腕二頭筋', '肩']);
    expect(tags.slice(2).every((t) => t.main === '回復済み')).toBe(true);
  });

  test('回復中が 3 つあれば、回復済みは 1 つだけ（札で体をふさがない）。押した部位はそれに足す', () => {
    const d = [...rows('2026-11-16', 'chest', 1), ...rows('2026-11-16', 'back', 1), ...rows('2026-11-16', 'legs', 1), ...rows('2026-11-12', 'shoulder', 1), ...rows('2026-11-11', 'abs', 1)];
    const c = recoveryCandidates(partRecoveries(d, nameOf, ['胸', '肩', '背中', '脚', '腹筋'], today));
    const tags = selectHeroTags(c, null, HERO_TAG_MAX, HERO_TAG_MAX_WITH_RECOVERED);
    expect(keys(tags)).toHaveLength(4);
    expect(tags.filter((t) => t.main === '回復済み')).toHaveLength(1);
    expect(keys(selectHeroTags(c, '腹筋', HERO_TAG_MAX, HERO_TAG_MAX_WITH_RECOVERED))).toHaveLength(5);
  });
});

describe('押した所から部位を選ぶ', () => {
  const w = { kind: 'phase' as const, title: '', label: '', from: '2026-11-10', to: '2026-11-16', rehab: [] };
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
