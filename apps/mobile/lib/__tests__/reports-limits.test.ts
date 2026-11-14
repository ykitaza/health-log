// レポートの種類・調子・分野・見直しの対象と、読むときに切る件数が、サーバーの決まり（services/reports のドメイン）と
// 同じであることを確かめる。サーバーが保存できる値をアプリが知らないと、読むときに黙って捨てたり切ったりするため。
// 値はサーバーのソースから読む（ほかの突き合わせ（server-limits・meals-limits）と同じ）
import * as fs from 'fs';
import * as path from 'path';
import { AREA_LABELS, KIND_LABELS, parseReport, ReportRow, TONE_LABELS } from '../reports';

const root = path.join(__dirname, '..', '..', '..', '..');
const report = fs.readFileSync(path.join(root, 'services/reports/reports/domain/report.py'), 'utf8');

/** `class Tone(StrEnum):` の中の `GOOD = "good"` の値（並びのまま） */
function enumValues(name: string): string[] {
  const body = report.split(new RegExp(`^class ${name}\\(StrEnum\\):$`, 'm'))[1]?.split(/^\S/m)[0];
  if (body == null) throw new Error(`${name} がない`);
  return [...body.matchAll(/^\s+[A-Z_0-9]+ = "(\w+)"/gm)].map((m) => m[1]);
}

/** `MAX_HIGHLIGHTS = 6` の値 */
function limit(name: string): number {
  const m = new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(report);
  if (m == null) throw new Error(`${name} がない`);
  return Number(m[1]);
}

const row = (over: Partial<ReportRow>): ReportRow => ({
  id: 'r1', title: '週のまとめ', body: '', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08',
  overall_tone: 'good', headline: '', highlights: null, next_steps: null, links: null, review: null,
  created_at: '2026-11-09T01:00:00.000Z', ...over,
});

describe('レポートのサーバーの決まりと合っている', () => {
  test('種類・調子・分野の値と並びが同じ', () => {
    expect(Object.keys(KIND_LABELS)).toEqual(enumValues('Kind'));
    expect(Object.keys(TONE_LABELS)).toEqual(enumValues('Tone'));
    expect(Object.keys(AREA_LABELS)).toEqual(enumValues('Area'));
  });

  test('サーバーのどの種類・調子・分野も、読むときに捨てない', () => {
    for (const kind of enumValues('Kind')) expect(parseReport(row({ kind })).kind).toBe(kind);
    for (const tone of enumValues('Tone')) expect(parseReport(row({ overall_tone: tone })).tone).toBe(tone);
    const highlights = enumValues('Area').map((area) => ({ area, tone: 'good', text: 'x' }));
    expect(parseReport(row({ highlights: JSON.stringify(highlights) })).highlights.map((h) => h.area)).toEqual(enumValues('Area'));
  });

  test('目標の見直しの対象（ReviewTarget）は、どれも読む', () => {
    for (const target of enumValues('ReviewTarget')) {
      expect(parseReport(row({ review: JSON.stringify({ text: '見直す', target }) })).review?.target).toBe(target);
    }
  });

  test('読むときに切る件数は、サーバーの上限と同じ（上限までは切らない）', () => {
    const highlights = Array.from({ length: limit('MAX_HIGHLIGHTS') + 1 }, (_, i) => ({ area: 'training', tone: 'good', text: `h${i}` }));
    const steps = Array.from({ length: limit('MAX_NEXT_STEPS') + 1 }, (_, i) => `s${i}`);
    const links = Array.from({ length: limit('MAX_LINKS') + 1 }, (_, i) => ({ from_area: 'sleep', to_area: 'training', text: `l${i}` }));
    const parsed = parseReport(row({ highlights: JSON.stringify(highlights), next_steps: JSON.stringify(steps), links: JSON.stringify(links) }));
    expect(parsed.highlights).toHaveLength(limit('MAX_HIGHLIGHTS'));
    expect(parsed.nextSteps).toHaveLength(limit('MAX_NEXT_STEPS'));
    expect(parsed.links).toHaveLength(limit('MAX_LINKS'));
  });
});
