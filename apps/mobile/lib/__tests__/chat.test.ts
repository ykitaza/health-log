import { addDays } from '../date';
import { ChatPrompt, chatUrl, openChat, openFailedMessage, orderedApps, promptSummary, promptText } from '../chat';

const TODAY = '2026-11-09';
const C = 'hlog（健康記録の MCP コネクタ）';
const SAVED = '保存したら、記録した内容を短く見せてください。';

describe('まとめの文', () => {
  test('日：今日の日付で、読むツール・書き方・保存の引数を入れる', () => {
    expect(promptText({ kind: 'report', span: 'day', today: TODAY })).toBe(
      `${C}で今日（11月9日）のまとめを作ってください。`
      + 'get_workout と today_status（day=2026-11-09）、body_progress・sleep_summary・heart_rate_summary（days=7）を読み、数字は記録の値だけを使い推測で補わないでください。'
      + '良い点と気をつける点を3つほど、次の一歩を1〜2つ、責めない言い方で書き、save_report で保存してください（kind=daily、period_start=2026-11-09、period_end=2026-11-09、overall_tone、headline、highlights の area と tone）。'
      + '保存したら、アプリで画面を下に引っぱって同期すると見られると一言添えてください。');
  });

  test('週：今日までの7日（weekly_review と同じ区切り）', () => {
    const text = promptText({ kind: 'report', span: 'week', today: TODAY });
    expect(text).toContain('11月3日〜今日（11月9日）の7日間のまとめ');
    expect(text).toContain('list_workouts（start=2026-11-03、end=2026-11-09）、weekly_review（last_day=2026-11-09）');
    expect(text).toContain('（days=7）');
    expect(text).toContain('良い点と気をつける点を6つまで、次の一歩を3つまで');
    expect(text).toContain('（kind=weekly、period_start=2026-11-03、period_end=2026-11-09、');
  });

  test('月：その月の1日から今日まで。月や年をまたぐ週も正しく数える', () => {
    const text = promptText({ kind: 'report', span: 'month', today: TODAY });
    expect(text).toContain('11月1日〜今日（11月9日）のまとめ');
    expect(text).toContain('list_workouts と list_meals（start=2026-11-01、end=2026-11-09）');
    expect(text).toContain('（days=9）');
    expect(text).toContain('（kind=monthly、period_start=2026-11-01、period_end=2026-11-09、');
    expect(promptText({ kind: 'report', span: 'month', today: '2026-10-31' })).toContain('（days=31）');
    expect(promptText({ kind: 'report', span: 'month', today: '2026-11-03' })).toContain('（days=7）');
    expect(promptText({ kind: 'report', span: 'week', today: '2026-01-02' })).toContain('12月27日〜今日（1月2日）の7日間のまとめ');
    expect(promptText({ kind: 'report', span: 'week', today: '2026-01-02' })).toContain('list_workouts（start=2025-12-27、end=2026-01-02）');
  });

  test('今日が決まった形でなければ、日付を入れない', () => {
    const text = promptText({ kind: 'report', span: 'week', today: 'x&q=1' });
    expect(text).toContain(`${C}で今日までの7日間のまとめ`);
    expect(text).toContain('list_workouts、weekly_review、body_progress');
    expect(text).toContain('（kind=weekly、overall_tone、');
    expect(text).not.toMatch(/x&q|\d{4}-/);
  });
});

describe('筋トレの文', () => {
  test('今日は「今日（11月9日）」、種目の一覧と記録のツールの名前を入れる', () => {
    expect(promptText({ kind: 'training', date: TODAY, today: TODAY })).toBe(
      `${C}に今日（11月9日）の筋トレを記録してください。`
      + 'これから伝える種目・重さ・回数・セットを list_exercises の一覧と照らし、record_workout（day=2026-11-09）で保存してください。'
      + '一覧にない種目は、add_exercise で足す前に名前と部位を確かめてください。' + SAVED);
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
      + '推定を見せて了承を得たら record_meal（date=2026-11-09、slot=dinner）で保存し、推定の根拠を basis に書いてください。' + SAVED);
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

const ALL: ChatPrompt[] = [
  { kind: 'report', span: 'day', today: TODAY },
  { kind: 'report', span: 'week', today: TODAY },
  { kind: 'report', span: 'month', today: '2026-12-31' },
  { kind: 'meal', date: TODAY, today: TODAY },
  { kind: 'meal', date: '2026-11-06', today: TODAY, slot: 'breakfast' },
  { kind: 'training', date: '2026-11-06', today: TODAY },
];

describe('どの文も', () => {
  test('URL は 2,000 文字まで（エンコードしたあと。2年分のどの日でも、いちばん長い区分でも）', () => {
    let longest = 0;
    for (let day = '2026-01-01'; day < '2028-01-01'; day = addDays(day, 1)) {
      const ps: ChatPrompt[] = [
        ...(['day', 'week', 'month'] as const).map((span) => ({ kind: 'report', span, today: day }) as const),
        { kind: 'meal', date: addDays(day, -1), today: day, slot: 'breakfast' },
        { kind: 'training', date: day, today: day },
      ];
      for (const p of ps) longest = Math.max(longest, chatUrl('claude', p).length, chatUrl('chatgpt', p).length);
    }
    expect(longest).toBeLessThanOrEqual(2000);
  });

  test('決まった文と日付だけ（日付以外の数字の並びや、渡したもの以外が入らない）', () => {
    for (const p of ALL) {
      const text = promptText(p);
      // 日付と days を除くと、残る数字は決まった件数（3つ・1〜2つ・6つ）だけ。記録の数字（重さ・kcal など）は入らない
      const rest = text.replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/\d{1,2}月\d{1,2}日/g, '').replace(/days=\d{1,2}/g, '');
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
