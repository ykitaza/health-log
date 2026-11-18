import { notifyBody, notifyMinutes, planNotification, NotifyInput } from '../notifyPlan';
import { reschedule, RescheduleDeps } from '../reschedule';

/** 日本時間の時刻 */
const jst = (s: string) => new Date(`${s}+09:00`);
// 2026-11-18 は水曜。週は 11/16（月）〜 11/22（日）
const NOW = jst('2026-11-18T09:00:00');

const base = (o: Partial<NotifyInput> = {}): NotifyInput => ({
  now: NOW, handDue: ['2026-11-18', '2026-11-18', '2026-11-18'], opens: [], sent: [], selfListens: [], permitted: true, ...o,
});

describe('時刻', () => {
  it('記録が5回より少なければ 20:00', () => {
    expect(notifyMinutes([jst('2026-11-17T07:10:00')], NOW)).toBe(20 * 60);
  });

  it('直近14日の中央値を15分単位に丸める', () => {
    const opens = ['07:50', '08:05', '08:10', '21:40', '08:20'].map((t, i) => jst(`2026-11-1${i}T${t}:00`));
    expect(notifyMinutes(opens, NOW)).toBe(8 * 60 + 15); // 中央値 8:10 → 8:15
  });

  it('7:00〜22:00 におさめる。14日より前は数えない', () => {
    const early = Array.from({ length: 5 }, (_, i) => jst(`2026-11-1${i}T05:00:00`));
    expect(notifyMinutes(early, NOW)).toBe(7 * 60);
    const late = Array.from({ length: 5 }, (_, i) => jst(`2026-11-1${i}T23:30:00`));
    expect(notifyMinutes(late, NOW)).toBe(22 * 60);
    const old = Array.from({ length: 5 }, (_, i) => jst(`2026-10-1${i}T08:00:00`));
    expect(notifyMinutes(old, NOW)).toBe(20 * 60);
  });
});

describe('いつ送るか', () => {
  it('期限の手札が3つ以上ある日の、その時刻', () => {
    const p = planNotification(base());
    expect(p?.at).toEqual(jst('2026-11-18T20:00:00'));
    expect(p?.count).toBe(3);
    expect(p?.body).toBe('手札の言葉が3つ、聞いて確かめごろです');
  });

  it('3つになる日を先に計算して予約する', () => {
    const p = planNotification(base({ handDue: ['2026-11-18', '2026-11-19', '2026-11-21', null] }));
    expect(p?.at).toEqual(jst('2026-11-21T20:00:00'));
  });

  it('今日の時刻を過ぎていれば、次の日', () => {
    const p = planNotification(base({ now: jst('2026-11-18T21:00:00') }));
    expect(p?.at).toEqual(jst('2026-11-19T20:00:00'));
  });

  it('週に2回まで（月曜〜日曜）。超えたら次の週の月曜', () => {
    const p = planNotification(base({ sent: [jst('2026-11-16T08:00:00'), jst('2026-11-16T09:00:00')] }));
    expect(p?.at).toEqual(jst('2026-11-23T20:00:00'));
  });

  it('前の通知から48時間以上あける', () => {
    const p = planNotification(base({ sent: [jst('2026-11-17T20:00:00')] }));
    expect(p?.at).toEqual(jst('2026-11-19T20:00:00'));
  });

  it('その週に自分で振り返ったら送らない（次の週に）', () => {
    const p = planNotification(base({ selfListens: [jst('2026-11-16T22:00:00')] }));
    expect(p?.at).toEqual(jst('2026-11-23T20:00:00'));
  });

  it('手札が空・許可していない・3つにならないときは送らない', () => {
    expect(planNotification(base({ handDue: [] }))).toBeNull();
    expect(planNotification(base({ permitted: false }))).toBeNull();
    expect(planNotification(base({ handDue: ['2026-11-18', null] }))).toBeNull();
  });

  it('文に続けた日数やさぼったことは書かない', () => {
    expect(notifyBody(4)).toBe('手札の言葉が4つ、聞いて確かめごろです');
  });
});

describe('予約し直す', () => {
  const make = (o: Partial<RescheduleDeps> = {}) => {
    const calls: string[] = [];
    let planned: string | null = null;
    const notified: Date[] = [];
    const d: RescheduleDeps = {
      now: () => NOW,
      notifier: {
        permitted: async () => true, request: async () => true, onOpen: () => () => {},
        schedule: async (at, title, body) => { calls.push(`schedule ${at.toISOString()} ${title} ${body}`); },
        cancel: async () => { calls.push('cancel'); },
      },
      handDue: async () => ['2026-11-18', '2026-11-18', '2026-11-18'],
      opens: async () => [], notified: async () => notified, recordNotified: async (at) => { notified.push(at); },
      selfListens: async () => [], planned: async () => planned, setPlanned: async (iso) => { planned = iso; },
      ...o,
    };
    return { d, calls, get planned() { return planned; }, notified };
  };

  it('予約は1つだけ入れ、時刻を覚える', async () => {
    const m = make();
    const plan = await reschedule(m.d);
    expect(plan?.at).toEqual(jst('2026-11-18T20:00:00'));
    expect(m.calls).toEqual([`schedule ${jst('2026-11-18T20:00:00').toISOString()} ことば 手札の言葉が3つ、聞いて確かめごろです`]);
    expect(m.planned).toBe(jst('2026-11-18T20:00:00').toISOString());
  });

  it('前の予約の時刻を過ぎていたら、送ったものとして数え、48時間あける', async () => {
    const m = make({ planned: async () => jst('2026-11-17T20:00:00').toISOString() });
    const plan = await reschedule(m.d);
    expect(m.notified).toEqual([jst('2026-11-17T20:00:00')]);
    expect(plan?.at).toEqual(jst('2026-11-19T20:00:00'));
  });

  it('送らないときは予約を消す', async () => {
    const m = make({ handDue: async () => [] });
    expect(await reschedule(m.d)).toBeNull();
    expect(m.calls).toEqual(['cancel']);
    expect(m.planned).toBeNull();
  });
});
