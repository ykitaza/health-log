import { addDays } from '../date';
import {
  ChatPrompt, chatUrl as chatUrlWith, MAX_URL_LENGTH, OPEN_BASE, openChat, openFailedMessage, orderedApps, pendingPrompt as pendingPromptWith, promptSummary,
  promptText as promptTextWith, REPORT_SCHEDULES,
} from '../chat';
import type { PendingReport } from '../reports';

// 戻るリンクの行き先（認可サーバー。lib/auth/config.ts の authzUrl）
const OPEN = OPEN_BASE;
const promptText = (p: ChatPrompt) => promptTextWith(p, OPEN);
const chatUrl = (app: Parameters<typeof chatUrlWith>[0], p?: ChatPrompt) => chatUrlWith(app, p, OPEN);
const pendingPrompt = (items: PendingReport[]) => pendingPromptWith(items, OPEN);
const back = (path: string, label = 'hlog に戻る') => `最後に [${label}](${OPEN}/open/${path}) を押せるリンクの形で添えてください。`;

const TODAY = '2026-11-09';
const C = 'hlog（健康記録の MCP コネクタ）';
const SAVED = '保存したら、記録した内容を短く見せてください。';

describe('まとめの文', () => {
  test('日：period_overview をその日で読み、達成はアプリが出すこと・体重は週の平均と比べること・明日の一歩・保存の引数を入れる', () => {
    expect(promptText({ kind: 'report', span: 'day', today: TODAY })).toBe(
      `${C}で今日（11月9日）のまとめを作ってください。`
      + 'period_overview(start=2026-11-09, end=2026-11-09)を読み、数字は記録の値だけを使い推測で補わないでください。達成の数字はアプリが出します。'
      + '分野ごとに目標に対して一言（体重は前の日でなく週の平均と比べる）、明日の一歩を1つ、責めない言い方で書き、'
      + 'save_report(kind=daily, period_start=2026-11-09, period_end=2026-11-09)で保存してください。'
      + '保存したら、' + back('reports', 'hlog で見る'));
  });

  test('週：月曜から今日まで（アプリの「今週の目標」と同じ区切り）。つながり（links）と来週の一歩', () => {
    const text = promptText({ kind: 'report', span: 'week', today: '2026-11-12' });
    expect(text).toContain(`${C}で今週（11月9日〜今日（11月12日））のまとめ`);
    expect(promptText({ kind: 'report', span: 'week', today: TODAY })).toContain(`${C}で今週（今日（11月9日））のまとめ`); // 月曜
    expect(text).toContain('period_overview(start=2026-11-09, end=2026-11-12)');
    expect(text).toContain('分野をまたぐ気づきを links に3つまで、来週の一歩を3つまで');
    expect(text).toContain('save_report(kind=weekly, period_start=2026-11-09, period_end=2026-11-12)');
    expect(promptText({ kind: 'report', span: 'week', today: '2026-01-02' })).toContain('period_overview(start=2025-12-29, end=2026-01-02)');
  });

  test('月：その月の1日から今日まで。体重のペース、links、review（食事の目標なら meals_goal）、来月の一歩', () => {
    const text = promptText({ kind: 'report', span: 'month', today: TODAY });
    expect(text).toContain(`${C}で今月（11月1日〜今日（11月9日））のまとめ`);
    expect(text).toContain('period_overview(start=2026-11-01, end=2026-11-09)');
    expect(text).toContain('体重の推移と目標までのペース');
    expect(text).toContain('目標の見直しを review に（食事の目標なら target=meals_goal）');
    expect(text).toContain('来月の一歩を3つまで');
    expect(text).toContain('save_report(kind=monthly, period_start=2026-11-01, period_end=2026-11-09)');
  });

  test('今日が決まった形でなければ、日付を入れない', () => {
    const text = promptText({ kind: 'report', span: 'week', today: 'x&q=1' });
    expect(text).toContain(`${C}で今週のまとめ`);
    expect(text).toContain('period_overviewを読み');
    expect(text).toContain('save_report(kind=weekly)で保存');
    expect(text).not.toMatch(/x&q|\d{4}-/);
  });
});

describe('まだのまとめを、まとめて作る文', () => {
  const p = (kind: PendingReport['kind'], start: string, end = start): PendingReport => ({ kind, periodStart: start, periodEnd: end, key: `${kind}:${start}` });
  const FIG = [p('daily', '2026-11-07'), p('daily', '2026-11-06'), p('weekly', '2026-10-26', '2026-11-01')];

  test('図の例：古い順に並べ、1件ずつ save_report で保存、種類ごとの要点、記録がなければ作らない、戻ると取り込まれる', () => {
    expect(promptText({ kind: 'pending', items: FIG })).toBe(
      `${C}で、まだ作っていないまとめを1件ずつ作り、save_report で保存してください。`
      + '対象は3件：weekly(2026-10-26..2026-11-01), daily(2026-11-06), daily(2026-11-07)。'
      + '期間ごとに period_overview を読み、数字は記録の値だけを使ってください。'
      + '日は明日の一歩を1つ（体重は週の平均と比べる）、週は links と来週の一歩を3つまで。'
      + '記録がない期間は作らず、そう伝えてください。'
      + '終わったら、' + back('reports'));
    expect(promptSummary({ kind: 'pending', items: FIG })).toBe('まだのまとめ 3 件を作る');
  });

  test('月があれば review も。URL の上限を超えるなら件数を絞り、残りは次にと書く', () => {
    const all = [
      p('monthly', '2026-10-01', '2026-10-31'),
      ...['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'].map((d) => p('weekly', d, addDays(d, 6))),
      ...Array.from({ length: 8 }, (_, i) => p('daily', addDays('2026-11-03', i))),
    ];
    const { text, included } = pendingPrompt(all);
    expect(included.length).toBeGreaterThan(1);
    expect(included.length).toBeLessThan(all.length);
    expect(included[0].kind).toBe('monthly'); // 古い順
    expect(text).toContain('月は links・review と来月の一歩を3つまで');
    expect(text).toContain(`対象は${included.length}件：`);
    expect(text).toContain(`残りの${all.length - included.length}件は次に頼みます。`);
    for (const app of ['claude', 'chatgpt'] as const) expect(chatUrl(app, { kind: 'pending', items: all }).length).toBeLessThanOrEqual(2000);
    expect(pendingPrompt(FIG).included).toHaveLength(3);
  });

  test('決まった形でない期間は入れない', () => {
    const bad = { ...p('daily', '2026-11-06'), periodStart: '2026-11-06&x=1' };
    const text = promptText({ kind: 'pending', items: [bad, p('daily', '2026-11-07')] });
    expect(text).toContain('対象は1件：daily(2026-11-07)。');
    expect(text).not.toContain('x=1');
  });
});

describe('自動で作る（ChatGPT のスケジュール）の文', () => {
  const schedule = { kind: 'schedule' } as const;

  test('3つの予定を入れてもらう。すでに hlog のまとめのタスクがあれば作らずに教えてもらう。各回は list_reports → period_overview → save_report', () => {
    expect(promptText(schedule)).toBe(
      `${C}で、まとめのスケジュールを3つ入れてください。`
      + 'hlog のまとめのタスクがもうあれば、作らず教えてください。'
      + '1.毎日22:00 その日(daily) 2.毎週月曜8:00 先週の月〜日(weekly) 3.毎月1日8:00 先月(monthly)。'
      + '各回：list_reports(kind)に同じ期間があれば作らない。'
      + 'なければ period_overview(start, end)を読み、記録の値だけで書いて save_report(kind, period_start, period_end)で保存。'
      + '記録がなければ作らない。'
      + '日は明日の一歩を1つ（体重は週の平均と比べる）、週は links と来週の一歩を3つまで、月は links・review と来月の一歩を3つまで。'
      + 'ほかは save_report の説明どおり。');
  });

  test('URL は 2,000 文字まで（ChatGPT で開く。全角は URL で1文字が9文字になる）', () => {
    expect(chatUrl('chatgpt', schedule).length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    expect(chatUrl('claude', schedule).length).toBeLessThanOrEqual(MAX_URL_LENGTH);
  });

  test('シートの予定の一覧（日・週・月）と説明', () => {
    expect(REPORT_SCHEDULES.map((s) => `${s.title} ${s.when}（${s.period}）`)).toEqual([
      '日のまとめ 毎日 22:00（その日の分）', '週のまとめ 毎週月曜 8:00（先週の分）', '月のまとめ 毎月1日 8:00（先月の分）',
    ]);
    expect(promptSummary(schedule)).toBe('まとめを自動で作る予定を入れる');
  });
});

describe('筋トレの文', () => {
  test('今日は「今日（11月9日）」、種目の一覧と記録のツールの名前を入れる', () => {
    expect(promptText({ kind: 'training', date: TODAY, today: TODAY })).toBe(
      `${C}に今日（11月9日）の筋トレを記録してください。`
      + 'これから伝える種目・重さ・回数・セットを list_exercises の一覧と照らし、record_workout（day=2026-11-09）で保存してください。'
      + '一覧にない種目は、add_exercise で足す前に名前と部位を確かめてください。' + SAVED
      + back('training?date=2026-11-09'));
  });

  test('過去の日は「11月6日」、決まった形でない日付は今日として扱う', () => {
    const past = promptText({ kind: 'training', date: '2026-11-06', today: TODAY });
    expect(past).toContain(`${C}に11月6日の筋トレを記録してください。`);
    expect(past).toContain('record_workout（day=2026-11-06）');
    const bad = promptText({ kind: 'training', date: '2026-11-06T00:00', today: TODAY });
    expect(bad).toBe(promptText({ kind: 'training', date: TODAY, today: TODAY }));
  });
});

describe('食事の文', () => {
  test('区分を選んでいれば、区分の名前と slot を入れる', () => {
    expect(promptText({ kind: 'meal', date: TODAY, today: TODAY, slot: 'dinner' })).toBe(
      `${C}に今日（11月9日）の夕食を記録してください。`
      + 'これから送る写真や説明から品目と量を推定してカロリーと PFC を出し、量が分からなければ先に1つだけ質問してください。'
      + '推定を見せて了承を得たら record_meal（date=2026-11-09、slot=dinner）で保存し、推定の根拠を basis に書いてください。' + SAVED
      + back('meals?date=2026-11-09'));
    const past = promptText({ kind: 'meal', date: '2026-11-06', today: TODAY, slot: 'breakfast' });
    expect(past).toContain(`${C}に11月6日の朝食を記録してください。`);
    expect(past).toContain('record_meal（date=2026-11-06、slot=breakfast）');
  });

  test('区分がなければ「食事」で、slot を入れない', () => {
    const text = promptText({ kind: 'meal', date: '2026-01-05', today: TODAY });
    expect(text).toContain(`${C}に1月5日の食事を記録してください。`);
    expect(text).toContain('record_meal（date=2026-01-05）で保存し');
  });

  test('決まった区分・日付でなければ、文に入れない', () => {
    const slot = 'x&q=1' as unknown as 'lunch';
    expect(promptText({ kind: 'meal', date: TODAY, today: TODAY, slot })).toBe(promptText({ kind: 'meal', date: TODAY, today: TODAY }));
    expect(promptText({ kind: 'meal', date: 'メモ&x=1', today: TODAY })).toBe(promptText({ kind: 'meal', date: TODAY, today: TODAY }));
    expect(promptText({ kind: 'meal', date: 'メモ', today: 'メモ' })).toContain(`${C}に今日の食事を記録してください。`);
    expect(promptText({ kind: 'meal', date: 'メモ', today: 'メモ' })).toContain('record_meal で保存し');
    expect(promptText({ kind: 'training', date: 'メモ', today: 'メモ' })).toContain('record_workout で保存して');
  });
});

describe('ケガの文', () => {
  const NO_DX = '痛みの強さは聞かず、診断しないでください。';

  test('記録：種目・場面・部位と左右・何が起きたか・原因・直し方を聞き取り、record_injury で保存。言葉のまま、推測で埋めない、痛みの強さや診断は聞かない。ケガの一覧へ戻る', () => {
    expect(promptText({ kind: 'injury', today: TODAY })).toBe(
      `${C}にケガを記録してください。`
      + '種目・場面・部位と左右・何が起きたか・原因（自分の分析）・次の直し方を聞き取り、record_injury で保存してください。'
      + '種目は list_exercises の名前で、痛めた日が今日（11月9日）でなければ day に。'
      + '原因と直し方は私の言葉のまま、分からない所は推測で埋めず空に。' + NO_DX + SAVED + back('injuries'));
    expect(promptSummary({ kind: 'injury', today: TODAY })).toBe('ケガを記録する');
  });

  test('振り返り：痛めた日を手がかりに list_injuries で探して確かめ、add_injury_review で保存。直せたなら mark_injury_fixed を確かめる', () => {
    expect(promptText({ kind: 'injury-review', occurredOn: '2026-11-03', today: TODAY })).toBe(
      `${C}にケガの振り返りを記録してください。`
      + 'list_injuries で11月3日に痛めたケガを探して私に確かめ、'
      + '試したことと結果を聞き取り、add_injury_review で保存してください。'
      + '試した日が今日（11月9日）でなければ day に。'
      + 'メモは私の言葉のまま、推測で埋めずに。直せたなら mark_injury_fixed も呼ぶか聞いてください。'
      + NO_DX + SAVED + back('injuries'));
    expect(promptSummary({ kind: 'injury-review', occurredOn: '2026-11-03', today: TODAY })).toBe('ケガの振り返りを記録する');
  });

  test('決まった形でない日付は入れない（ケガの中身や ID も入れない）', () => {
    const text = promptText({ kind: 'injury-review', occurredOn: '右肩&x=1', today: 'x&q=1' });
    expect(text).toContain('list_injuries でケガを探して');
    expect(text).toContain('試した日が今日でなければ');
    expect(text).not.toMatch(/右肩|x=1|q=1/);
    expect(promptText({ kind: 'injury', today: 'x&q=1' })).toContain('痛めた日が今日でなければ');
  });
});

const ALL: ChatPrompt[] = [
  { kind: 'report', span: 'day', today: TODAY },
  { kind: 'report', span: 'week', today: TODAY },
  { kind: 'report', span: 'month', today: '2026-12-31' },
  { kind: 'meal', date: TODAY, today: TODAY },
  { kind: 'meal', date: '2026-11-06', today: TODAY, slot: 'breakfast' },
  { kind: 'training', date: '2026-11-06', today: TODAY },
  { kind: 'injury', today: TODAY },
  { kind: 'injury-review', occurredOn: '2026-11-03', today: TODAY },
  { kind: 'pending', items: [{ kind: 'weekly', periodStart: '2026-11-02', periodEnd: '2026-11-08', key: 'weekly:2026-11-02' }] },
  { kind: 'schedule' },
];

describe('どの文も', () => {
  test('URL は 2,000 文字まで（エンコードしたあと。2年分のどの日でも、いちばん長い区分でも）', () => {
    let longest = 0;
    for (let day = '2026-01-01'; day < '2028-01-01'; day = addDays(day, 1)) {
      const ps: ChatPrompt[] = [
        ...(['day', 'week', 'month'] as const).map((span) => ({ kind: 'report', span, today: day }) as const),
        { kind: 'meal', date: addDays(day, -1), today: day, slot: 'breakfast' },
        { kind: 'training', date: day, today: day },
        { kind: 'injury', today: day },
        { kind: 'injury-review', occurredOn: addDays(day, -30), today: day },
      ];
      for (const p of ps) longest = Math.max(longest, chatUrl('claude', p).length, chatUrl('chatgpt', p).length);
    }
    expect(longest).toBeLessThanOrEqual(2000);
  });

  test('決まった文と日付だけ（日付以外の数字の並びや、渡したもの以外が入らない）', () => {
    for (const p of ALL) {
      const text = promptText(p);
      // 日付を除くと、残る数字は決まった件数（1つ・3つまで）だけ。記録の数字（重さ・kcal など）は入らない
      const rest = text.replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/\d{1,2}月\d{1,2}日/g, '');
      expect(rest).not.toMatch(/\d{3,}/);
      expect(text).not.toMatch(/[\n<>&@]/);
    }
  });

  test('シートの説明は短い文', () => {
    expect(promptSummary({ kind: 'report', span: 'week', today: TODAY })).toBe('今週のまとめを作る');
    expect(promptSummary({ kind: 'meal', date: TODAY, today: TODAY, slot: 'dinner' })).toBe('今日の夕食を記録する');
    expect(promptSummary({ kind: 'meal', date: '2026-11-06', today: TODAY })).toBe('11月6日の食事を記録する');
    expect(promptSummary({ kind: 'training', date: 'x', today: TODAY })).toBe('今日の筋トレを記録する');
  });
});

describe('開く URL', () => {
  test('選んだアプリの URL に、エンコードした文を q で入れる', () => {
    const meal = { kind: 'meal', date: TODAY, today: TODAY } as const;
    expect(chatUrl('chatgpt', meal)).toBe(`https://chatgpt.com/?q=${encodeURIComponent(promptText(meal))}`);
    const week = { kind: 'report', span: 'week', today: TODAY } as const;
    expect(chatUrl('claude', week)).toBe(`https://claude.ai/new?q=${encodeURIComponent(promptText(week))}`);
    const training = { kind: 'training', date: '2026-11-06', today: TODAY } as const;
    const url = new URL(chatUrl('claude', training));
    expect(url.origin + url.pathname).toBe('https://claude.ai/new');
    expect([...url.searchParams.keys()]).toEqual(['q']);
    expect(url.searchParams.get('q')).toBe(promptText(training));
    expect(chatUrl('claude', { kind: 'meal', date: TODAY, today: TODAY })).not.toMatch(/[ 　-鿿]/);
  });

  test('文がなければアプリを開くだけ', () => {
    expect(chatUrl('chatgpt')).toBe('https://chatgpt.com/');
    expect(chatUrl('claude')).toBe('https://claude.ai/new');
  });
});

describe('開く', () => {
  test('開けたら true、開いた URL は選んだアプリのもの', async () => {
    const open = jest.fn(async () => {});
    const day = { kind: 'report', span: 'day', today: TODAY } as const;
    expect(await openChat('claude', day, open)).toBe(true);
    expect(open).toHaveBeenCalledWith(`https://claude.ai/new?q=${encodeURIComponent(promptText(day))}`);
  });

  test('開けなかったら false（呼ぶ側が案内を出す）', async () => {
    const open = jest.fn(async () => { throw new Error('no activity'); });
    expect(await openChat('chatgpt', undefined, open)).toBe(false);
    expect(openFailedMessage('chatgpt')).toBe('ChatGPT を開けませんでした。ブラウザで開けるか確かめてください。');
  });

  test('最後に選んだほうを上に（初めは ChatGPT）', () => {
    expect(orderedApps(null)).toEqual(['chatgpt', 'claude']);
    expect(orderedApps('chatgpt')).toEqual(['chatgpt', 'claude']);
    expect(orderedApps('claude')).toEqual(['claude', 'chatgpt']);
  });
});


describe('戻るリンク', () => {
  test('行き先（認可サーバーの URL）がなければ、リンクを添えてもらう文を入れない', () => {
    for (const p of [
      { kind: 'meal', date: TODAY, today: TODAY }, { kind: 'training', date: TODAY, today: TODAY },
      { kind: 'report', span: 'week', today: TODAY }, { kind: 'injury', today: TODAY },
      { kind: 'injury-review', occurredOn: TODAY, today: TODAY },
    ] as ChatPrompt[]) {
      const text = promptTextWith(p, '');
      expect(text).not.toContain('/open/');
      expect(text).not.toContain('リンク');
    }
  });
});
