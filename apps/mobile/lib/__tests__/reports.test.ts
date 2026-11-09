import {
  deltaLook, formatDelta, formatMetricValue, formatPeriod, Metric, metricLabel, parseInline, parseMarkdown, parseReport, primaryMetrics,
  ReportRow, reportCardLabel,
} from '../reports';

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: 'r1', title: '今週のまとめ', body: '', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08',
  overall_tone: 'good', headline: '脚の日が増えた', highlights: null, next_steps: null, created_at: '2026-11-09T01:00:00.000Z', ...over,
});
const metric = (over: Partial<Metric> = {}): Metric => ({ label: '体重', value: 70.4, unit: 'kg', delta: -0.3, deltaGood: true, ...over });

describe('レポートを読む', () => {
  test('前の形（overall_tone がない）は steady、知らない種類は other', () => {
    expect(parseReport(row({ overall_tone: null, kind: 'daily', headline: null }))).toMatchObject({ tone: 'steady', kind: 'other', headline: '' });
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
    expect(reportCardLabel(parseReport(row()))).toMatch(/^良い調子、今週のまとめ、脚の日が増えた、\d+月\d+日に作成$/);
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
