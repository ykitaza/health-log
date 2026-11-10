import {
  dailyHighlightLabel, dailySectionTitle, deltaLook, emptyFilterText, filterReports, formatDelta, groupByMonth, highlightsFor, KIND_LABELS, NEXT_TITLES,
  formatMetricValue, formatPeriod, Metric, metricLabel, parseInline, parseMarkdown, parseReport, pendingReports, primaryMetrics, ReportRow, reportCardLabel, TAB_AREAS,
} from '../reports';

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: 'r1', title: '今週のまとめ', body: '', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08',
  overall_tone: 'good', headline: '脚の日が増えた', highlights: null, next_steps: null, created_at: '2026-11-09T01:00:00.000Z', ...over,
});
const metric = (over: Partial<Metric> = {}): Metric => ({ label: '体重', value: 70.4, unit: 'kg', delta: -0.3, deltaGood: true, ...over });

describe('レポートを読む', () => {
  test('前の形（overall_tone がない）は steady、知らない種類は other', () => {
    expect(parseReport(row({ overall_tone: null, kind: 'yearly', headline: null }))).toMatchObject({ tone: 'steady', kind: 'other', headline: '' });
  });

  test('日のまとめ（daily）を読み、名前と次の一歩の見出しを出す', () => {
    const r = parseReport(row({ kind: 'daily', period_start: '2026-11-09', period_end: '2026-11-09' }));
    expect(r.kind).toBe('daily');
    expect([KIND_LABELS[r.kind], NEXT_TITLES[r.kind]]).toEqual(['日のまとめ', '明日の一歩']);
  });

  test('highlights は形の合うものだけ、6件まで。指標は値が数のときだけ。delta がなければ delta_good も使わない', () => {
    const ok = { area: 'body', tone: 'steady', text: '横ばい' };
    const highlights = JSON.stringify([
      { ...ok, metric: { label: '体重', value: 70.4, unit: 'kg', delta: null, delta_good: true } },
      { ...ok, area: 'mood' }, { ...ok, tone: 'bad' }, { ...ok, text: ' ' }, 'x',
      { ...ok, metric: { label: '体重', value: '70' } },
      ...Array.from({ length: 10 }, () => ok),
    ]);
    const r = parseReport(row({ highlights }));
    expect(r.highlights).toHaveLength(6);
    expect(r.highlights[0].metric).toEqual({ label: '体重', value: 70.4, unit: 'kg', delta: null, deltaGood: null });
    expect(r.highlights[1].metric).toBeNull();
  });

  test('next_steps は文字だけ、3件まで', () => {
    expect(parseReport(row({ next_steps: JSON.stringify(['a', 2, '', 'b', 'c', 'd']) })).nextSteps).toEqual(['a', 'b', 'c']);
  });

  test('主な指標は、指標のあるハイライトの先頭から2つ', () => {
    const h = (label: string | null) => ({ area: 'training', tone: 'good', text: 't', metric: label ? { label, value: 1 } : null });
    const r = parseReport(row({ highlights: JSON.stringify([h(null), h('a'), h('b'), h('c')]) }));
    expect(primaryMetrics(r).map((m) => m.label)).toEqual(['a', 'b']);
  });
});

describe('見せ方', () => {
  test('期間（同じ日なら1つ、なければ null）', () => {
    expect(formatPeriod({ periodStart: '2026-11-02', periodEnd: '2026-11-08' })).toBe('11月2日（月）〜11月8日（日）');
    expect(formatPeriod({ periodStart: '2026-11-08', periodEnd: '2026-11-08' })).toBe('11月8日（日）');
    expect(formatPeriod({ periodStart: null, periodEnd: null })).toBeNull();
  });

  test('値は3桁ごとにカンマ、小数は2桁まで。変化は符号つき、0 は ±0', () => {
    expect(formatMetricValue(2410)).toBe('2,410');
    expect(formatMetricValue(12.454)).toBe('12.45');
    expect(formatMetricValue(70.4)).toBe('70.4');
    expect(formatMetricValue(-1234.5)).toBe('-1,234.5');
    expect(formatDelta(1.3)).toBe('+1.3');
    expect(formatDelta(-0.6)).toBe('-0.6');
    expect(formatDelta(0.001)).toBe('±0');
  });

  test('変化の矢印は増減、色は目標にとって良いか（減量中の体重の減りは良い）', () => {
    expect(deltaLook(metric())).toEqual({ arrow: 'down', quality: 'good' });
    expect(deltaLook(metric({ delta: 0.2, deltaGood: false }))).toEqual({ arrow: 'up', quality: 'bad' });
    expect(deltaLook(metric({ delta: 5, deltaGood: null }))).toEqual({ arrow: 'up', quality: 'neutral' });
    expect(deltaLook(metric({ delta: 0, deltaGood: true }))).toEqual({ arrow: 'flat', quality: 'neutral' });
    expect(deltaLook(metric({ delta: null }))).toBeNull();
  });

  test('読み上げは、色に頼らず言葉で伝える', () => {
    expect(metricLabel(metric())).toBe('体重 70.4 kg、前より 0.3 減った、良い変化');
    expect(metricLabel(metric({ delta: 0.2, deltaGood: false }))).toBe('体重 70.4 kg、前より 0.2 増えた、気をつけたい変化');
    expect(metricLabel(metric({ delta: null }))).toBe('体重 70.4 kg');
    expect(reportCardLabel(parseReport(row()))).toMatch(/^良い調子、今週のまとめ、脚の日が増えた、週のまとめ、\d+月\d+日に作成$/);
  });
});

describe('一覧の絞り込みと月の見出し', () => {
  // 作った時刻は、どの時間帯でも同じ日になる時刻（UTC の 3時）
  const at = (d: string) => `${d}T03:00:00.000Z`;
  const list = [
    parseReport(row({ id: 'w', kind: 'weekly', created_at: at('2026-11-09') })),
    parseReport(row({ id: 'd2', kind: 'daily', created_at: at('2026-11-08') })),
    parseReport(row({ id: 'o', kind: 'other', created_at: at('2026-11-05') })),
    parseReport(row({ id: 'd1', kind: 'daily', created_at: at('2026-10-31') })),
    parseReport(row({ id: 'm', kind: 'monthly', created_at: at('2025-12-01') })),
  ];
  const ids = (l: { id: string }[]) => l.map((r) => r.id);

  test('種類で絞る。「すべて」はその他も出す。並びは変えない', () => {
    expect(ids(filterReports(list, 'all'))).toEqual(['w', 'd2', 'o', 'd1', 'm']);
    expect(ids(filterReports(list, 'daily'))).toEqual(['d2', 'd1']);
    expect(ids(filterReports(list, 'weekly'))).toEqual(['w']);
    expect(filterReports(list.slice(0, 4), 'monthly')).toEqual([]);
  });

  test('作った月ごとに区切る。今年は「11月」、年が違えば「2025年12月」', () => {
    expect(groupByMonth(list, '2026-11-09').map((g) => [g.title, ids(g.reports)])).toEqual([
      ['11月', ['w', 'd2', 'o']], ['10月', ['d1']], ['2025年12月', ['m']],
    ]);
    expect(groupByMonth(filterReports(list, 'daily'), '2026-11-09').map((g) => g.title)).toEqual(['11月', '10月']);
    expect(groupByMonth([], '2026-11-09')).toEqual([]);
  });

  test('絞り込んで0件のときの題と頼み方。種類のラベル', () => {
    expect(emptyFilterText('daily')).toEqual({ title: '日のまとめはまだありません', body: 'チャット（Claude・ChatGPT）で「今日のまとめを作って」と頼むと、ここに出ます。' });
    expect(emptyFilterText('monthly').title).toBe('月のまとめはまだありません');
    expect(KIND_LABELS).toEqual({ daily: '日のまとめ', weekly: '週のまとめ', monthly: '月のまとめ', other: 'その他' });
  });
});

describe('各タブに出す、その日の日のまとめ', () => {
  const highlights = JSON.stringify([
    { area: 'sleep', tone: 'steady', text: '睡眠はいつもどおり' },
    { area: 'training', tone: 'good', text: 'ベンチプレスを3セット', metric: { label: '合計負荷量', value: 2.33, unit: 't', delta: 0.4, delta_good: true } },
    { area: 'meals', tone: 'steady', text: 'たんぱく質は 98g' },
    { area: 'body', tone: 'caution', text: '体重が 0.6kg 増えた' },
  ]);
  const daily = parseReport(row({ kind: 'daily', period_start: '2026-11-08', period_end: '2026-11-08', highlights }));
  const texts = (areas: readonly ('training' | 'meals' | 'body' | 'sleep')[]) => highlightsFor(daily, areas).map((h) => h.text);

  test('分野で分ける：筋トレ＝training、食事＝meals、からだ＝body と sleep（並びはレポートのまま）', () => {
    expect(texts(TAB_AREAS.training)).toEqual(['ベンチプレスを3セット']);
    expect(texts(TAB_AREAS.meals)).toEqual(['たんぱく質は 98g']);
    expect(texts(TAB_AREAS.body)).toEqual(['睡眠はいつもどおり', '体重が 0.6kg 増えた']);
    expect(highlightsFor(null, TAB_AREAS.body)).toEqual([]);
    expect(highlightsFor(parseReport(row({ kind: 'daily' })), TAB_AREAS.training)).toEqual([]);
  });

  test('題は「今日のまとめから」、過去の日は「11月6日のまとめから」。読み上げは言葉で', () => {
    expect(dailySectionTitle('2026-11-08', '2026-11-08')).toBe('今日のまとめから');
    expect(dailySectionTitle('2026-11-06', '2026-11-08')).toBe('11月6日のまとめから');
    const [training] = highlightsFor(daily, TAB_AREAS.training);
    expect(dailyHighlightLabel(training)).toBe('筋トレ、良い。ベンチプレスを3セット。合計負荷量 2.33 t、前より 0.4 増えた、良い変化');
    expect(dailyHighlightLabel(highlightsFor(daily, ['meals'])[0])).toBe('食事、変わらない。たんぱく質は 98g');
  });
});

describe('本文（Markdown）を見分ける', () => {
  test('見出し・箇条書き（記号と番号）・段落。段落の中の改行は残す', () => {
    expect(parseMarkdown('# 題\n\n## 筋トレ\n- 脚の日\n* 背中\n1. 寝る\n2) 食べる\n\n一行目\n二行目\n\n次の段落')).toEqual([
      { type: 'heading', level: 1, spans: [{ text: '題', bold: false }] },
      { type: 'heading', level: 2, spans: [{ text: '筋トレ', bold: false }] },
      { type: 'bullet', marker: '•', spans: [{ text: '脚の日', bold: false }] },
      { type: 'bullet', marker: '•', spans: [{ text: '背中', bold: false }] },
      { type: 'bullet', marker: '1.', spans: [{ text: '寝る', bold: false }] },
      { type: 'bullet', marker: '2.', spans: [{ text: '食べる', bold: false }] },
      { type: 'paragraph', spans: [{ text: '一行目\n二行目', bold: false }] },
      { type: 'paragraph', spans: [{ text: '次の段落', bold: false }] },
    ]);
  });

  test('太字（** と __）。閉じていない記号はそのまま', () => {
    expect(parseInline('合計 **12.45 t** と __自己ベスト__')).toEqual([
      { text: '合計 ', bold: false }, { text: '12.45 t', bold: true }, { text: ' と ', bold: false }, { text: '自己ベスト', bold: true },
    ]);
    expect(parseInline('**閉じない')).toEqual([{ text: '**閉じない', bold: false }]);
  });

  test('リンク・画像・HTML・表は見分けず、書かれた文字のまま', () => {
    const body = '[押す](https://evil.example) ![x](y.png) <script>alert(1)</script> | a | b |';
    expect(parseMarkdown(body)).toEqual([{ type: 'paragraph', spans: [{ text: body, bold: false }] }]);
  });

  test('改行の \\r\\n をそろえ、空の本文は何も出さない', () => {
    expect(parseMarkdown('a\r\nb')).toEqual([{ type: 'paragraph', spans: [{ text: 'a\nb', bold: false }] }]);
    expect(parseMarkdown('\n \n')).toEqual([]);
  });
});

describe('まだ作っていないまとめ', () => {
  // 2026-11-10 は火曜。今週は 11/9（月）〜11/15（日）
  const at = (hour: number) => new Date(2026, 10, 10, hour, 0);
  const keys = (list: { key: string }[]) => list.map((p) => p.key);

  test('記録のある日・週・月だけ。日は7日前から昨日、週は4週前から先週（月〜日）、月は先月', () => {
    const recordDates = ['2026-09-30', '2026-10-10', '2026-10-20', '2026-11-02', '2026-11-03', '2026-11-09', '2026-11-10'];
    const out = pendingReports({ now: at(20), reports: [], recordDates });
    expect(keys(out)).toEqual(['daily:2026-11-09', 'daily:2026-11-03', 'weekly:2026-11-02', 'weekly:2026-10-19', 'monthly:2026-10-01']);
    expect(out.find((p) => p.kind === 'weekly')).toEqual({ kind: 'weekly', periodStart: '2026-11-02', periodEnd: '2026-11-08', key: 'weekly:2026-11-02' });
    expect(out.at(-1)).toMatchObject({ periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    // 11/2 は8日前なので日のまとめに出さない。10/10 の週（10/5〜）は5週前なので出さない
    expect(keys(out)).not.toContain('daily:2026-11-02');
  });

  test('今日の日のまとめは、21時を過ぎていて今日に記録があるときだけ', () => {
    expect(keys(pendingReports({ now: at(20), reports: [], recordDates: ['2026-11-10'] }))).toEqual([]);
    expect(keys(pendingReports({ now: at(21), reports: [], recordDates: ['2026-11-10'] }))).toEqual(['daily:2026-11-10']);
    expect(keys(pendingReports({ now: at(22), reports: [], recordDates: ['2026-11-09'] }))).toEqual(['daily:2026-11-09']);
  });

  test('作ってある分（同じ種類で、期間の半分より多く重なる）と、閉じた分は出さない', () => {
    const recordDates = ['2026-11-03', '2026-11-05', '2026-10-28'];
    const reports = [
      { kind: 'daily' as const, periodStart: '2026-11-05', periodEnd: '2026-11-05' },
      // 日曜始まりの週のまとめ（11/1〜11/7）は、11/2〜11/8 の週を作ってあるとみなす
      { kind: 'weekly' as const, periodStart: '2026-11-01', periodEnd: '2026-11-07' },
      // 週のまとめは日のまとめの代わりにならない
      { kind: 'weekly' as const, periodStart: '2026-11-03', periodEnd: '2026-11-03' },
      { kind: 'monthly' as const, periodStart: null, periodEnd: null },
    ];
    expect(keys(pendingReports({ now: at(10), reports, recordDates }))).toEqual(['daily:2026-11-03', 'weekly:2026-10-26', 'monthly:2026-10-01']);
    expect(keys(pendingReports({ now: at(10), reports, recordDates, dismissed: ['daily:2026-11-03', 'monthly:2026-10-01'] }))).toEqual(['weekly:2026-10-26']);
  });

  test('1月なら先月は前の年の12月', () => {
    const out = pendingReports({ now: new Date(2027, 0, 5, 9), reports: [], recordDates: ['2026-12-31'] });
    expect(out.at(-1)).toEqual({ kind: 'monthly', periodStart: '2026-12-01', periodEnd: '2026-12-31', key: 'monthly:2026-12-01' });
  });
});
