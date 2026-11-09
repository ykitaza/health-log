import { chatUrl, openChat, openFailedMessage, orderedApps, promptText } from '../chat';

const TODAY = '2026-11-08';

describe('チャットに入れる文', () => {
  test('決まった文だけ。今日なら日付を入れない', () => {
    expect(promptText({ kind: 'meal', date: TODAY, today: TODAY })).toBe('hlog に食事を記録して');
    expect(promptText({ kind: 'training', date: TODAY, today: TODAY })).toBe('hlog に今日の筋トレを記録して');
    expect(promptText({ kind: 'report', span: 'day' })).toBe('今日のまとめを作って');
    expect(promptText({ kind: 'report', span: 'week' })).toBe('今週のまとめを作って');
    expect(promptText({ kind: 'report', span: 'month' })).toBe('今月のまとめを作って');
  });

  test('過去の日は「11月6日」の形で入れる', () => {
    expect(promptText({ kind: 'training', date: '2026-11-06', today: TODAY })).toBe('hlog に 11月6日 の筋トレを記録して');
    expect(promptText({ kind: 'meal', date: '2026-01-05', today: TODAY })).toBe('hlog に 1月5日 の食事を記録して');
  });

  test('決まった形でない日付は、文に入れない', () => {
    expect(promptText({ kind: 'meal', date: 'メモ&x=1', today: TODAY })).toBe('hlog に食事を記録して');
    expect(promptText({ kind: 'training', date: '2026-11-06T00:00', today: TODAY })).toBe('hlog に今日の筋トレを記録して');
  });
});

describe('食事の区分を入れた文', () => {
  test('区分を選んでいれば、決まった形で区分を入れる（今日は「今日の」）', () => {
    expect(promptText({ kind: 'meal', date: TODAY, today: TODAY, slot: 'dinner' })).toBe('hlog に今日の夕食を記録して');
    expect(promptText({ kind: 'meal', date: '2026-11-06', today: TODAY, slot: 'breakfast' })).toBe('hlog に 11月6日 の朝食を記録して');
    expect(promptText({ kind: 'meal', date: '2026-11-06', today: TODAY, slot: 'snack' })).toBe('hlog に 11月6日 の間食を記録して');
  });

  test('決まった区分でなければ、区分を入れない', () => {
    const slot = 'x&q=1' as unknown as 'lunch';
    expect(promptText({ kind: 'meal', date: TODAY, today: TODAY, slot })).toBe('hlog に食事を記録して');
    expect(promptText({ kind: 'meal', date: '2026-11-06', today: TODAY, slot })).toBe('hlog に 11月6日 の食事を記録して');
  });
});

describe('開く URL', () => {
  test('選んだアプリの URL に、エンコードした文を q で入れる', () => {
    expect(chatUrl('chatgpt', { kind: 'meal', date: TODAY, today: TODAY }))
      .toBe(`https://chatgpt.com/?q=${encodeURIComponent('hlog に食事を記録して')}`);
    expect(chatUrl('claude', { kind: 'report', span: 'week' }))
      .toBe(`https://claude.ai/new?q=${encodeURIComponent('今週のまとめを作って')}`);
    const url = new URL(chatUrl('claude', { kind: 'training', date: '2026-11-06', today: TODAY }));
    expect(url.origin + url.pathname).toBe('https://claude.ai/new');
    expect([...url.searchParams.keys()]).toEqual(['q']);
    expect(url.searchParams.get('q')).toBe('hlog に 11月6日 の筋トレを記録して');
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
    expect(await openChat('claude', { kind: 'report', span: 'day' }, open)).toBe(true);
    expect(open).toHaveBeenCalledWith(`https://claude.ai/new?q=${encodeURIComponent('今日のまとめを作って')}`);
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
