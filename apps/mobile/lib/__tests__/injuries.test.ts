import {
  dotDate, fixedOnFor, injuryInputError, InjuryInput, injuryNumbers, normalizeInjury, phasesFor, siteDetail, siteLabel, SITE_CODES, SITES,
} from '../injuries';

describe('部位の名前', () => {
  test('左右のある部位は「右肩」「左ひざ」、「の」を挟む部位は「右の二頭筋」。左右のない部位・左右が分からないものは名前だけ', () => {
    expect(siteLabel('shoulder_front', 'right')).toBe('右肩');
    expect(siteLabel('knee', 'left')).toBe('左ひざ');
    expect(siteLabel('biceps', 'right')).toBe('右の二頭筋');
    expect(siteLabel('waist', null)).toBe('腰');
    expect(siteLabel('waist', 'left')).toBe('腰'); // 左右のない部位の左右は捨てる
    expect(siteLabel('elbow', null)).toBe('ひじ');
    expect(siteDetail('shoulder_front')).toBe('三角筋（前）');
  });

  test('知らないコード（あとの版で足したもの）も出せる', () => {
    expect(siteLabel('toe', 'left')).toBe('ほかの部位');
    expect(siteDetail('toe')).toBe('toe');
  });

  test('短い名前は部位ごとにちがう（一覧で見分けられる）', () => {
    expect(new Set(SITE_CODES.map((c) => SITES[c].short)).size).toBe(SITE_CODES.length);
  });
});

describe('場面の候補', () => {
  test('BIG3 は種目ごとの場面、ほかの種目は共通の場面', () => {
    expect(phasesFor('bench')).toEqual(['ラックアップ', '下ろす', '押し上げる', 'ラックに戻す']);
    expect(phasesFor('squat')).toEqual(['担ぐ', 'しゃがむ', '立ち上がる', 'ラックに戻す']);
    expect(phasesFor('deadlift')).toEqual(['引き始め', '引き上げる', '下ろす']);
    expect(phasesFor(null)).toEqual(['始める', '下ろす', '上げる', '戻す']);
  });
});

describe('受け取った値をそろえる', () => {
  const base = { site: 'knee', side: 'left', status: 'fixing', fixedOn: null };
  test('左右のない部位の左右・知らない左右は捨てる。直せた日は直せたのときだけ。知らない状態は直している途中', () => {
    expect(normalizeInjury({ ...base, site: 'neck' }).side).toBeNull();
    expect(normalizeInjury({ ...base, side: 'up' }).side).toBeNull();
    expect(normalizeInjury({ ...base, fixedOn: '2026-11-07' }).fixedOn).toBeNull();
    expect(normalizeInjury({ ...base, status: 'fixed', fixedOn: '2026-11-07' })).toMatchObject({ status: 'fixed', fixedOn: '2026-11-07' });
    expect(normalizeInjury({ ...base, status: 'fixed' })).toMatchObject({ status: 'fixed', fixedOn: null });
    expect(normalizeInjury({ ...base, status: 'closed' }).status).toBe('fixing');
  });
});

describe('入力の確かめ', () => {
  const input: InjuryInput = { occurredOn: '2026-11-06', site: 'knee', side: 'left', exerciseId: null, phase: '', symptom: '', cause: '', fix: '' };
  test('よい入力は null。原因と直し方は空でもよい', () => {
    expect(injuryInputError(input, '2026-11-08')).toBeNull();
    expect(injuryInputError({ ...input, side: null }, '2026-11-08')).toBeNull();
  });
  test('部位なし・左右のない部位の左右・未来の日・直せた日より後・長すぎる文字', () => {
    expect(injuryInputError({ ...input, site: '' }, '2026-11-08')).toBe('痛めた部位を選んでください');
    expect(injuryInputError({ ...input, site: 'neck' }, '2026-11-08')).toBe('首には左右がありません');
    expect(injuryInputError({ ...input, occurredOn: '2026-11-09' }, '2026-11-08')).toBe('未来の日には記録できません');
    expect(injuryInputError(input, '2026-11-08', '2026-11-05')).toBe('痛めた日は、直せた日と同じか前の日にしてください');
    expect(injuryInputError({ ...input, symptom: 'あ'.repeat(501) }, '2026-11-08')).toBe('何が起きたかは500文字以内で入れてください（今は501文字）');
    expect(injuryInputError({ ...input, phase: ` ${'あ'.repeat(100)} ` }, '2026-11-08')).toBeNull(); // 前後の空白は数えない
  });
});

describe('番号と日付', () => {
  test('INJ の番号は記録した順（作った時刻、同じなら ID）に 01 から', () => {
    const n = injuryNumbers([
      { id: 'b', createdAt: '2026-11-06T00:00:00Z' },
      { id: 'a', createdAt: '2026-07-03T00:00:00Z' },
      { id: 'c', createdAt: '2026-11-06T00:00:00Z' },
    ]);
    expect([n.get('a'), n.get('b'), n.get('c')]).toEqual(['INJ-01', 'INJ-02', 'INJ-03']);
  });
  test('11.06 の形。直せた日は今日（痛めた日より前にはしない）', () => {
    expect(dotDate('2026-11-06')).toBe('11.06');
    expect(fixedOnFor('2026-11-01', '2026-11-08')).toBe('2026-11-08');
    expect(fixedOnFor('2026-11-09', '2026-11-08')).toBe('2026-11-09');
  });
});
