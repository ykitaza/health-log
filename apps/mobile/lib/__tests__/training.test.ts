import {
  bestSet, estimated1RM, exerciseDailySeries, filterSince, periodStart,
  lastTopSets, personalBests, rmTable, setVolume, topSet, totalVolume, TrainingSetRow, trainingDates,
  daysInMonth, vehicleRatio, weeklyVolumeByBodyPart, dailyVolumeByBodyPart, dailySummary, dayFocus, entryCardLabel,
  focusByDate, focusParts, partSuggestion, recentFlow,
} from '../training';

const row = (date: string, weightKg: number | null, reps: number, exerciseId = 'bench', bodyPartId = 'chest'): TrainingSetRow =>
  ({ date, weightKg, reps, exerciseId, bodyPartId });

describe('推定1RM（2回以上は Epley 式、1回なら重量そのもの）', () => {
  test('80kg × 8回 は 101.3kg', () => {
    expect(estimated1RM(80, 8)).toBeCloseTo(101.333, 2);
    expect(estimated1RM(100, 2)).toBeCloseTo(106.667, 2);
  });
  test('1回なら重量そのもの', () => {
    expect(estimated1RM(100, 1)).toBe(100);
    expect(estimated1RM(62.5, 1)).toBe(62.5);
  });
  test('重さか回数がなければ 0', () => {
    expect(estimated1RM(null, 8)).toBe(0);
    expect(estimated1RM(80, 0)).toBe(0);
    expect(estimated1RM(-1, 5)).toBe(0);
    expect(estimated1RM(-1, 1)).toBe(0);
  });
  test('ベストのセット・日ごとの最大・自己ベストも、1回のセットは重量で比べる', () => {
    // 100kg × 1 は 100（Epley 式なら 103.3）、90kg × 3 は 99
    const sets = [row('2026-11-06', 100, 1), row('2026-11-06', 90, 3)];
    expect(bestSet(sets)?.e1rm).toBe(100);
    expect(exerciseDailySeries(sets, 'bench')[0].max1RM).toBe(100);
    expect(personalBests(sets).get('bench')).toMatchObject({ e1rm: 100, weightKg: 100, reps: 1 });
    // 105kg × 1（105。Epley 式なら 108.5）より 100kg × 2（106.7）が上
    expect(bestSet([{ weightKg: 105, reps: 1 }, { weightKg: 100, reps: 2 }])?.weightKg).toBe(100);
  });
});

describe('負荷量', () => {
  test('重量 × 回数。回数だけの種目は 0', () => {
    expect(setVolume({ weightKg: 80, reps: 8 })).toBe(640);
    expect(setVolume({ weightKg: null, reps: 20 })).toBe(0);
    expect(totalVolume([{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 7 }])).toBe(1840);
  });
  test('ベストのセットと、いちばん重いセット', () => {
    const sets = [{ weightKg: 80, reps: 8 }, { weightKg: 85, reps: 3 }, { weightKg: 75, reps: 10 }];
    expect(bestSet(sets)?.weightKg).toBe(80); // 101.3 > 100 > 93.5
    expect(topSet(sets)?.weightKg).toBe(85);
    expect(bestSet([])).toBeNull();
  });
});

describe('乗り物のたとえと、トレーニングした日数', () => {
  const rows = [
    row('2026-11-08', 100, 10), // 1000（今日）
    row('2026-11-02', 100, 5), //  500（6日前、今週の月曜）
    row('2026-11-01', 100, 3), //  300（7日前）
    row('2026-10-12', 100, 2), //  200（27日前）
    row('2026-10-11', 100, 1), //  100（28日前）
    row('2026-11-09', 100, 100), // 未来は数えない
  ];
  test('乗り物のたとえ', () => {
    expect(vehicleRatio(12450, 'car')).toBeCloseTo(8.3, 1);
    expect(vehicleRatio(48300, 'bus')).toBeCloseTo(3.22, 2);
    expect(vehicleRatio(970180, 'jumbo')).toBeCloseTo(2.8, 1);
  });
  test('トレーニングした日数', () => {
    const dates = trainingDates([...rows, row('2026-11-08', 50, 5)]);
    expect(dates).toHaveLength(6);
    expect(daysInMonth(dates, 2026, 11)).toBe(4);
  });
});

describe('種目ごとの推移', () => {
  const rows = [
    row('2026-11-06', 80, 8), row('2026-11-06', 75, 10),
    row('2026-11-01', 80, 6),
    row('2026-11-06', 100, 5, 'squat', 'legs'),
  ];
  test('日ごとの総負荷量と最大RM', () => {
    const s = exerciseDailySeries(rows, 'bench');
    expect(s.map((p) => p.date)).toEqual(['2026-11-01', '2026-11-06']);
    expect(s[1].volume).toBe(1390);
    expect(s[1].max1RM).toBeCloseTo(101.333, 2);
  });
  test('期間で絞る', () => {
    expect(periodStart('2026-11-08', '3m')).toBe('2026-08-08');
    expect(periodStart('2026-11-08', 'all')).toBeNull();
    expect(filterSince([{ date: '2026-08-07' }, { date: '2026-08-08' }], '2026-08-08')).toHaveLength(1);
  });
  test('自己ベスト（その日より前だけでも見られる）', () => {
    const pb = personalBests(rows);
    expect(pb.get('bench')).toMatchObject({ weightKg: 80, reps: 8, date: '2026-11-06' });
    expect(personalBests(rows, '2026-11-06').get('bench')).toMatchObject({ weightKg: 80, reps: 6 });
    expect(pb.get('squat')?.e1rm).toBeCloseTo(116.67, 1);
  });
});

test('部位ごとの週の総負荷量', () => {
  const rows = [
    row('2026-11-08', 100, 10, 'bench', 'chest'),
    // 日曜は、その前の月曜からの週に入る
    row('2026-11-01', 50, 10, 'row', 'back'),
    row('2026-11-01', 100, 5, 'squat', 'legs'),
    row('2026-11-01', null, 20, 'pushup', 'chest'), // 回数だけは 0
  ];
  const w = weeklyVolumeByBodyPart(rows, '2026-11-08', 3);
  expect(w.map((x) => x.weekStart)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
  expect(w[2]).toEqual({ weekStart: '2026-11-02', byPart: { chest: 1000 }, total: 1000 });
  expect(w[1].byPart).toEqual({ back: 500, legs: 500 });
});

describe('部位ごとの日の総負荷量（4週。週ごとと同じ月曜始まり）', () => {
  // 今日は 2026-11-09（月曜）。4週は 10/19（月）〜 11/15（日）の 28 日
  const today = '2026-11-09';
  const rows: TrainingSetRow[] = [
    row('2026-10-18', 100, 10), // 範囲の前の日（日曜）は入らない
    row('2026-10-19', 50, 10, 'row', 'back'), // 範囲の最初の日
    row('2026-11-01', 60, 10), // 日曜と次の月曜で分かれる
    row('2026-11-02', 70, 10),
    row('2026-11-02', 100, 5, 'squat', 'legs'),
    row('2026-11-09', 80, 5), // 今日
    row('2026-11-09', 80, 5),
    { ...row('2026-11-09', null, 10, 'pushup'), bodyweightLoadKg: 42 }, // 自重：体重 70 × 0.6 × 10 回
    row('2026-11-09', null, 10, 'pullup', 'back'), // 体重の記録がない自重は 0
    row('2026-11-10', 100, 10), // 今日より後は入らない
  ];
  const days = dailyVolumeByBodyPart(rows, today);

  test('28日の範囲で、今日を含み、今週の日曜まで並ぶ', () => {
    expect(days).toHaveLength(28);
    expect(days[0].date).toBe('2026-10-19');
    expect(days[27].date).toBe('2026-11-15');
    expect(days.findIndex((d) => d.date === today)).toBe(21);
    expect(days[22]).toEqual({ date: '2026-11-10', byPart: {}, total: 0 });
  });

  test('日ごとに分けて、部位ごとに積む。自重は体重 × 割合 × 回数', () => {
    expect(days[0]).toEqual({ date: '2026-10-19', byPart: { back: 500 }, total: 500 });
    expect(days[13]).toEqual({ date: '2026-11-01', byPart: { chest: 600 }, total: 600 });
    expect(days[14]).toEqual({ date: '2026-11-02', byPart: { chest: 700, legs: 500 }, total: 1200 });
    expect(days[21]).toEqual({ date: today, byPart: { chest: 400 + 400 + 420 }, total: 1220 });
  });

  test('休みの日は 0（部位の値もない）', () => {
    const rest = days.filter((d) => ![0, 13, 14, 21].includes(days.indexOf(d)));
    expect(rest).toHaveLength(24);
    expect(rest.every((d) => d.total === 0 && Object.keys(d.byPart).length === 0)).toBe(true);
  });

  test('日曜が今日なら、最後の日が今日', () => {
    const sun = dailyVolumeByBodyPart(rows, '2026-11-15');
    expect(sun[0].date).toBe('2026-10-19');
    expect(sun[27]).toMatchObject({ date: '2026-11-15', total: 0 });
    // 11/10 は今日（11/15）より前なので入る
    expect(sun[22].total).toBe(1000);
  });

  test('4週分の日ごとの合計は、週ごとの合計と同じ（部位ごとも）', () => {
    for (const t of [today, '2026-11-12', '2026-11-15']) {
      const d = dailyVolumeByBodyPart(rows, t, 4);
      const w = weeklyVolumeByBodyPart(rows, t, 4);
      for (let i = 0; i < 4; i++) {
        const week = d.slice(i * 7, i * 7 + 7);
        expect(week[0].date).toBe(w[i].weekStart);
        expect(week.reduce((a, x) => a + x.total, 0)).toBeCloseTo(w[i].total, 6);
        for (const part of ['chest', 'back', 'legs']) {
          expect(week.reduce((a, x) => a + (x.byPart[part] ?? 0), 0)).toBeCloseTo(w[i].byPart[part] ?? 0, 6);
        }
      }
    }
  });

  test('見出しの数字：合計、いちばん多かった日、した日数', () => {
    expect(dailySummary(days)).toEqual({ total: 500 + 600 + 1200 + 1220, peak: days[21], activeDays: 4 });
    // 同じ量なら早い日
    expect(dailySummary(dailyVolumeByBodyPart([row('2026-11-02', 10, 10), row('2026-11-03', 10, 10)], today)).peak?.date).toBe('2026-11-02');
    expect(dailySummary(dailyVolumeByBodyPart([], today))).toEqual({ total: 0, peak: null, activeDays: 0 });
  });
});

test('RM計算機の表', () => {
  const t = rmTable(100);
  expect(t).toHaveLength(6);
  expect(t[0]).toEqual({ pct: 95, reps: 2, weight: 95 });
  expect(t[5]).toEqual({ pct: 70, reps: 12, weight: 70 });
});

describe('過去の日を基準にした「前回」と自己ベスト', () => {
  const rows = [
    row('2026-11-01', 80, 8), row('2026-11-01', 85, 5),
    row('2026-11-03', 70, 10),
    row('2026-11-08', 100, 5), // 選んだ日より後（今日）の記録
    row('2026-11-01', 100, 5, 'squat', 'legs'),
  ];

  test('前回は、選んだ日まで（その日を含む）でいちばん新しい日の、いちばん重いセット', () => {
    const before = lastTopSets(rows, '2026-11-02');
    expect(before.get('bench')).toMatchObject({ date: '2026-11-01', top: { weightKg: 85, reps: 5 } });
    expect(before.get('squat')).toMatchObject({ date: '2026-11-01' });
    // その日に記録があれば、その日。後の日（11/8）は使わない
    expect(lastTopSets(rows, '2026-11-03').get('bench')).toMatchObject({ date: '2026-11-03', top: { weightKg: 70 } });
    expect(lastTopSets(rows, '2026-11-07').get('bench')?.date).toBe('2026-11-03');
    expect(lastTopSets(rows, '2026-11-08').get('bench')).toMatchObject({ date: '2026-11-08', top: { weightKg: 100 } });
    expect(lastTopSets(rows, '2026-10-31').size).toBe(0);
  });

  test('自己ベストは、選んだ日より前だけで出す（後の日の記録は入らない）', () => {
    // 推定1RM：80×8 = 101.3、85×5 = 99.2、70×10 = 93.3、100×5 = 116.7
    expect(personalBests(rows, '2026-11-03').get('bench')).toMatchObject({ weightKg: 80, date: '2026-11-01' });
    expect(personalBests(rows, '2026-11-08').get('bench')?.weightKg).toBe(80);
    expect(personalBests(rows, '2026-11-01').get('bench')).toBeUndefined();
    expect(personalBests(rows).get('bench')?.weightKg).toBe(100);
  });
});

describe('その日の部位（focusParts・dayFocus）', () => {
  const v = (part: string, volume: number) => ({ part, volume });
  test('部位ごとに総負荷量を足し、いちばん多い部位。2番目が7割未満なら1つ', () => {
    expect(focusParts([v('胸', 1000), v('肩', 300), v('胸', 500), v('上腕三頭筋', 600)])).toEqual(['胸']);
  });
  test('2番目が1番目の7割以上なら2つ（ちょうど7割も）', () => {
    expect(focusParts([v('胸', 1000), v('肩', 700)])).toEqual(['胸', '肩']);
    expect(focusParts([v('胸', 1000), v('肩', 699)])).toEqual(['胸']);
    expect(focusParts([v('肩', 400), v('胸', 600), v('肩', 400)])).toEqual(['肩', '胸']);
  });
  test('同じ量なら先に出た部位が先。名前のない部位は数えない。自分で足した部位もそのまま', () => {
    expect(focusParts([v('背中', 500), v('脚', 500)])).toEqual(['背中', '脚']);
    expect(focusParts([v(' ', 9999), v('首まわり', 100)])).toEqual(['首まわり']);
    expect(focusParts([])).toEqual([]);
  });
  test('負荷量がどれも 0（体重の記録のない自重の種目だけ）なら、セットの数で比べる', () => {
    expect(focusParts([v('背中', 0), v('背中', 0), v('背中', 0), v('腹筋', 0)])).toEqual(['背中']);
  });
  test('記録のまとめは「胸」「胸・肩」。自重の種目は自重の負荷量で数える', () => {
    const bench = { bodyPartName: '胸', sets: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }] }; // 1280
    const press = { bodyPartName: '肩', sets: [{ weightKg: 40, reps: 10 }] }; // 400
    expect(dayFocus([bench, press])).toEqual({ names: ['胸'], text: '胸', spoken: '胸' });
    // 懸垂：自重の負荷 70kg × 10回 × 2 = 1400 → 背中が多く、胸は 1280 で7割以上
    const pullUp = { bodyPartName: '背中', sets: [{ weightKg: null, reps: 10, bodyweightLoadKg: 70 }, { weightKg: null, reps: 10, bodyweightLoadKg: 70 }] };
    expect(dayFocus([bench, pullUp])).toEqual({ names: ['背中', '胸'], text: '背中・胸', spoken: '背中、胸' });
    expect(dayFocus([])).toEqual({ names: [], text: '', spoken: '' });
  });
});

describe('日ごとの部位・部位ごとの前回とおすすめ・最近の流れ', () => {
  const names: Record<string, string> = { chest: '胸', back: '背中', legs: '脚', shoulder: '肩' };
  const partName = (id: string) => names[id] ?? '';
  const days = focusByDate([
    row('2026-11-06', 80, 8, 'bench', 'chest'),
    row('2026-11-02', 100, 5, 'dead', 'back'),
    row('2026-11-04', 100, 5, 'squat', 'legs'),
    row('2026-11-06', 20, 10, 'press', 'shoulder'),
  ], partName);
  const TODAY = '2026-11-08';

  test('日付の昇順に、その日の部位', () => {
    expect(days).toEqual([
      { date: '2026-11-02', parts: ['背中'] },
      { date: '2026-11-04', parts: ['脚'] },
      { date: '2026-11-06', parts: ['胸'] },
    ]);
  });
  test('前回の新しい順に並べ、いちばん日があいている部位をおすすめにする', () => {
    const r = partSuggestion(days, ['胸', '背中', '肩', '脚', '上腕二頭筋'], TODAY);
    expect(r.rows).toEqual([
      { name: '胸', last: '2026-11-06', days: 2 },
      { name: '脚', last: '2026-11-04', days: 4 },
      { name: '背中', last: '2026-11-02', days: 6 },
    ]);
    expect(r.suggest).toEqual({ name: '背中', last: '2026-11-02', days: 6 });
  });
  test('一度もやっていない部位があれば、それをおすすめにする（2つあれば 背中・脚・胸 の順）', () => {
    const r = partSuggestion([{ date: '2026-11-06', parts: ['胸'] }], ['胸', '背中', '脚'], TODAY);
    expect(r.suggest?.name).toBe('背中');
    expect(r.rows.map((x) => [x.name, x.days])).toEqual([['胸', 2], ['背中', null], ['脚', null]]);
  });
  test('「肩・脚」の日は脚の前回にも数える。今日とそれより後の日は前回にしない', () => {
    const r = partSuggestion([
      { date: '2026-11-03', parts: ['背中'] }, { date: '2026-11-05', parts: ['肩', '脚'] }, { date: '2026-11-06', parts: ['胸'] },
      { date: '2026-11-08', parts: ['背中'] },
    ], ['胸', '背中', '脚'], TODAY);
    expect(r.rows.find((x) => x.name === '脚')?.last).toBe('2026-11-05');
    expect(r.suggest?.name).toBe('背中');
  });
  test('同じだけあいていれば 背中・脚・胸 の順', () => {
    const r = partSuggestion([{ date: '2026-11-05', parts: ['胸', '脚'] }, { date: '2026-11-05', parts: ['背中'] }], ['胸', '背中', '脚'], TODAY);
    expect(r.suggest?.name).toBe('背中');
  });
  test('名前が違う部位は出さない。どれも一度もやっていなければ何も出さない', () => {
    const r = partSuggestion(days, ['胸', 'あし', '背中'], TODAY);
    expect(r.rows.map((x) => x.name)).toEqual(['胸', '背中']);
    expect(partSuggestion(days, ['肩', '下半身'], TODAY)).toEqual({ rows: [], suggest: null });
    expect(partSuggestion([{ date: '2026-11-06', parts: ['肩'] }], ['胸', '背中', '脚'], TODAY)).toEqual({ rows: [], suggest: null });
  });
  test('最近の流れ：今日より前の直近3回（古い順）と、今日の部位', () => {
    const more = [{ date: '2026-10-30', parts: ['胸'] }, ...days];
    expect(recentFlow(more, TODAY)).toEqual({ past: days, today: null });
    expect(recentFlow([...more, { date: TODAY, parts: ['背中'] }], TODAY)).toEqual({ past: days, today: ['背中'] });
    expect(recentFlow([], TODAY)).toEqual({ past: [], today: null });
  });
});

describe('記録のタブの種目のカードの読み上げ（entryCardLabel）', () => {
  test('動き、部位、BIG3、推定1RM の順', () => {
    expect(entryCardLabel({ name: 'ベンチプレス', part: '胸', big3: true, e1rm: '101.3kg' })).toBe('ベンチプレスを直す。部位 胸、BIG3、推定1RM 101.3kg');
  });
  test('ないものは言わない', () => {
    expect(entryCardLabel({ name: '懸垂', part: '背中', big3: false, e1rm: null })).toBe('懸垂を直す。部位 背中');
    expect(entryCardLabel({ name: '懸垂', part: '', big3: false, e1rm: null })).toBe('懸垂を直す');
  });
});
