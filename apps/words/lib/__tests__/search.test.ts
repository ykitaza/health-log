import { chatUrl, intentChatUrl, MAX_URL_LENGTH, orderedApps, promptText } from '../chat';
import { makeCloze } from '../cloze';
import { applyFilter, groupByWork, rowSub } from '../collected';
import { applyFacets, EMPTY_FACETS, inPeriod, periodOptions } from '../facets';
import { buildSearchKey, likePattern, queryTerms, rankResults } from '../search';
import type { Source } from '../types';

describe('探す文字（search_key）', () => {
  it('項目を正規化して改行でつなぐ。空の項目は入れない', () => {
    const key = buildSearchKey({
      text: '腑に落ちる', reading: 'フニオチル', meaning: '心から納得する。', nuance: '', register: 'spoken', use_note: '', scene: '説明を聞いて',
      note: '', examples: ['ようやく腑に落ちた。'], situations: ['会議で'], feelings: ['安堵'], encounters: [{ scene: '1on1 で', title: '舟を編む', surrounding_text: '彼はようやく腑に落ちた。' }],
    });
    expect(key.split('\n')).toEqual(['腑に落ちる', 'ふにおちる', '心から納得する', '話し言葉', '会議で', '安堵', 'ようやく腑に落ちた', '説明を聞いて', '1on1で', '彼はようやく腑に落ちた', '舟を編む']);
  });

  it('探す言葉は空白で区切り、正規化する', () => {
    expect(queryTerms(' フニ　オチ  フニ ')).toEqual(['ふに', 'おち']);
    expect(likePattern('100%_\\')).toBe('%100\\%\\_\\\\%');
  });

  it('並べ方：表現・読みに一致（同じ → 前方 → 含む）→ 意味・こういう時に → それ以外。同じ順位は ★ など', () => {
    const base = { reading: '', meaning: '', use_note: '', star: false, place: 'collected' as const, tagWeight: 0 };
    const items = [
      { ...base, id: 'other', text: '筋がいい', created_at: '2026-11-05' },
      { ...base, id: 'meaning', text: '合点がいく', meaning: '納得する', created_at: '2026-11-04' },
      { ...base, id: 'contains', text: 'とても納得', created_at: '2026-11-03' },
      { ...base, id: 'prefix', text: '納得ずく', created_at: '2026-11-02' },
      { ...base, id: 'same', text: '納得', created_at: '2026-11-01' },
      { ...base, id: 'reading', text: '得心', reading: 'なっとく', created_at: '2026-11-06' },
    ];
    expect(rankResults(items, '納得').map((e) => e.id)).toEqual(['same', 'prefix', 'contains', 'meaning', 'reading', 'other']);
    expect(rankResults(items, 'ナットク').map((e) => e.id)[0]).toBe('reading');
  });
});

describe('絞り込み', () => {
  const item = (id: string, o: Partial<Parameters<typeof applyFacets>[0][number]> = {}) => ({
    id, text: id, reading: '', meaning: '', use_note: '', star: false, place: 'collected' as const, created_at: '2026-11-10T00:00:00Z', register: null, ...o,
  });
  const links = [
    { expression_id: 'a', tag_id: 'cheer', status: 'confirmed' as const },
    { expression_id: 'b', tag_id: 'cheer', status: 'proposed' as const },
    { expression_id: 'c', tag_id: 'cheer', status: 'rejected' as const },
    { expression_id: 'b', tag_id: 'praise', status: 'confirmed' as const },
  ];
  const enc = [{ expression_id: 'a', source_id: 'audible', title: '舟を編む' }, { expression_id: 'b', source_id: 'talk', title: '' }];

  it('同じ軸は「どれか」、軸どうしは「かつ」。rejected は使わない。確かめたタグが先', () => {
    const items = [item('a', { register: 'spoken' }), item('b', { register: 'spoken', created_at: '2026-11-11T00:00:00Z' }), item('c'), item('d')];
    const r = applyFacets(items, { ...EMPTY_FACETS, situations: ['cheer'] }, links, enc, '2026-11-18');
    expect(r.map((e) => e.id)).toEqual(['a', 'b']);
    expect(applyFacets(items, { ...EMPTY_FACETS, situations: ['cheer', 'praise'] }, links, enc, '2026-11-18').map((e) => e.id)).toEqual(['b', 'a']);
    expect(applyFacets(items, { ...EMPTY_FACETS, situations: ['cheer'], sources: ['talk'] }, links, enc, '2026-11-18').map((e) => e.id)).toEqual(['b']);
    expect(applyFacets(items, { ...EMPTY_FACETS, titles: ['舟を編む'] }, links, enc, '2026-11-18').map((e) => e.id)).toEqual(['a']);
    expect(applyFacets(items, { ...EMPTY_FACETS, registers: ['spoken'], starred: true }, links, enc, '2026-11-18')).toEqual([]);
  });

  it('時期：この1週間・月・年', () => {
    expect(inPeriod('2026-11-12T00:00:00Z', 'week', '2026-11-18')).toBe(true);
    expect(inPeriod('2026-11-11T00:00:00Z', 'week', '2026-11-18')).toBe(false);
    expect(inPeriod('2026-10-31T16:00:00Z', '2026-11', '2026-11-18')).toBe(true); // 日本時間では 11/1
    expect(inPeriod('2025-05-01T00:00:00Z', '2025', '2026-11-18')).toBe(true);
    expect(periodOptions(['2026-11-17T00:00:00Z', '2026-10-01T00:00:00Z', '2025-06-01T00:00:00Z'], '2026-11-18'))
      .toEqual([{ key: 'week', label: 'この1週間' }, { key: '2026-11', label: '11月' }, { key: '2026-10', label: '10月' }, { key: '2025', label: '去年' }]);
  });
});

describe('拾ったの一覧', () => {
  const sources: Source[] = [
    { id: 'aud', name: 'Audible', icon_key: 'headphones', sort_order: 0, hidden: false },
    { id: 'talk', name: '会話', icon_key: 'chat', sort_order: 1, hidden: false },
  ];
  const e = (id: string, o: Record<string, unknown> = {}) => ({
    id, text: id, scene: '', star: false, place: 'collected' as const, created_at: `2026-11-1${id.length}T00:00:00Z`, firstVia: 'app' as const,
    firstSourceId: 'aud', firstTitle: '街とその不確かな壁', firstMetOn: '2026-11-16', firstLocator: '', ...o,
  });

  it('本・人ごとにまとめる（本は『』。もう付いていれば重ねない。会話は日付と人）', () => {
    expect(groupByWork([e('z', { firstTitle: '『舟を編む』 三浦しをん' })], sources)[0].head).toBe('『舟を編む』 三浦しをん');
    const groups = groupByWork([e('a'), e('bb', { firstSourceId: 'talk', firstTitle: '編集の田中さん' }), e('ccc')], sources);
    expect(groups.map((g) => [g.head, g.sub, g.items.map((x) => x.id)])).toEqual([
      ['『街とその不確かな壁』', 'Audible', ['ccc', 'a']],
      ['会話', '11月16日 · 編集の田中さん', ['bb']],
    ]);
  });

  it('絞り込み（★・未記入・AI から・場所）と行の一言', () => {
    const items = [e('a', { star: true, scene: 'ほっとした' }), e('b', { firstVia: 'mcp', firstLocator: 'No.2310' }), e('c', { firstSourceId: 'talk' })];
    expect(applyFilter(items, 'star').map((x) => x.id)).toEqual(['a']);
    expect(applyFilter(items, 'unwritten').map((x) => x.id)).toEqual(['b', 'c']);
    expect(applyFilter(items, 'ai').map((x) => x.id)).toEqual(['b']);
    expect(applyFilter(items, 'source:talk').map((x) => x.id)).toEqual(['c']);
    expect(rowSub(items[0])).toBe('ほっとした');
    expect(rowSub(items[1])).toBe('Claude から · No.2310');
  });
});

describe('振り返りの空欄', () => {
  it('前後の文に言い回し（なければ表現）があれば、そこを空欄にする', () => {
    expect(makeCloze('肩の荷が下りる', [{ surrounding_text: '湯に身を沈めると、ようやく肩の荷が下りたような気がした。', wording: '肩の荷が下りた' }]))
      .toEqual({ before: '湯に身を沈めると、ようやく', answer: '肩の荷が下りた', after: 'ような気がした。' });
    expect(makeCloze('筋がいい', [{ surrounding_text: '', wording: '' }])).toBeNull();
    expect(makeCloze('筋がいい', [{ surrounding_text: '君は筋がいいね', wording: '' }])?.answer).toBe('筋がいい');
  });
});

describe('AI で拾う', () => {
  it('決まった文だけ。場所の名前は初期の5つのときだけ入れる', () => {
    expect(promptText({ kind: 'capture', seedSource: 'Audible' })).toContain('Audibleで出会ったものです。');
    expect(promptText({ kind: 'capture', seedSource: '〇〇さんの講演' })).not.toContain('〇〇');
    expect(promptText({ kind: 'capture', wantToUse: true })).toContain('手札に入れたいものです（want_to_use）。');
    expect(promptText({ kind: 'capture' })).toContain('capture_expression');
  });

  it('URL は https だけで、2,000文字まで。最後に選んだアプリを上に', () => {
    const url = chatUrl('claude', { kind: 'capture', seedSource: '紙の本', wantToUse: true });
    expect(url.startsWith('https://claude.ai/new?q=')).toBe(true);
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    expect(decodeURIComponent(url)).toContain('紙の本で出会ったものです。手札に入れたいものです');
    expect(intentChatUrl('chatgpt').length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    expect(chatUrl('chatgpt')).toBe('https://chatgpt.com/');
    expect(orderedApps('chatgpt')).toEqual(['chatgpt', 'claude']);
    expect(orderedApps(null)).toEqual(['claude', 'chatgpt']);
  });
});
