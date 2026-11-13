import {
  classifyInjuriesForPeriod, injuryPeriodInjuryCount, injuryPeriodReportLabel, isFixingAtPeriodEnd,
  type InjuryReportInjury, type InjuryReportReviewInput, statusAtPeriodEnd,
} from '../injuryReport';

// 週（月〜日）：2026-11-02（月）〜2026-11-08（日）
const START = '2026-11-02';
const END = '2026-11-08';

const inj = (id: string, over: Partial<InjuryReportInjury> = {}): InjuryReportInjury => ({
  id,
  occurredOn: '2026-11-05',
  site: 'shoulder_joint',
  side: 'right',
  exerciseId: 'bench',
  exerciseName: 'ベンチプレス',
  phase: 'ラックアップ',
  symptom: '違和感があった',
  cause: '肩で持ち上げた',
  fix: '肩甲骨を寄せてから外す',
  status: 'fixing',
  fixedOn: null,
  createdAt: '2026-11-05T10:00:00Z',
  reviewCount: 0,
  ...over,
});

const rev = (id: string, injuryId: string, date: string, over: Partial<InjuryReportReviewInput> = {}): InjuryReportReviewInput => ({
  id, injuryId, date, result: 'not_yet', note: '', exerciseId: null, exerciseName: null, ...over,
});

describe('ケガの振り返りの3分類（サーバーの period_injuries と同じ決まり）', () => {
  test('occurred：期間に痛めたものだけ（両端を含む）。期間の外は数えない', () => {
    const r = classifyInjuriesForPeriod([
      inj('first', { occurredOn: START }),
      inj('last', { occurredOn: END }),
      inj('before', { occurredOn: '2026-11-01' }),
      inj('after', { occurredOn: '2026-11-09' }),
    ], [], START, END);
    expect(r.occurred.map((e) => e.id)).toEqual(['first', 'last']);
    expect(r.occurredTotal).toBe(2);
  });

  test('表示用の形：番号は記録した順、部位は左右つきの名前、状態の言葉までそろう', () => {
    const r = classifyInjuriesForPeriod([
      inj('new', { createdAt: '2026-11-06T10:00:00Z' }),
      inj('old', { occurredOn: '2026-11-03', createdAt: '2026-11-03T10:00:00Z', site: 'lower_back', side: null, exerciseName: null }),
    ], [], START, END);
    const byId = new Map(r.occurred.map((e) => [e.id, e]));
    expect(byId.get('old')?.number).toBe('INJ-01');
    expect(byId.get('new')?.number).toBe('INJ-02');
    expect(byId.get('new')?.siteName).toBe('右肩の関節');
    expect(byId.get('old')?.siteName).toBe('腰の筋肉');
    expect(byId.get('new')).toMatchObject({
      exercise: 'ベンチプレス', phase: 'ラックアップ', symptom: '違和感があった',
      cause: '肩で持ち上げた', fix: '肩甲骨を寄せてから外す', status: 'fixing', statusLabel: '直している途中', fixedOn: null,
    });
    expect(byId.get('old')?.exercise).toBeNull();
  });

  test('reviewed：期間に振り返りを書いたものだけ。付ける振り返りは期間の分だけ（新しい順）で、総数はこれまでの分', () => {
    const r = classifyInjuriesForPeriod([
      inj('a', { occurredOn: '2026-10-20', reviewCount: 3 }),
      inj('b', { occurredOn: '2026-10-21', reviewCount: 1 }),
    ], [
      rev('r1', 'a', '2026-10-25', { result: 'pain' }), // 期間の外：付けない
      rev('r2', 'a', '2026-11-04', { result: 'not_yet', note: 'まだ痛む', exerciseName: 'ベンチプレス' }),
      rev('r3', 'a', '2026-11-07', { result: 'fixed' }),
      rev('r4', 'b', '2026-11-01'), // 期間の外だけ：reviewed に入らない
    ], START, END);
    expect(r.reviewed.map((e) => e.id)).toEqual(['a']);
    expect(r.reviewedTotal).toBe(1);
    const a = r.reviewed[0];
    expect(a.periodReviewCount).toBe(2);
    expect(a.reviewCount).toBe(3);
    expect(a.periodReviews.map((x) => x.id)).toEqual(['r3', 'r2']);
    expect(a.periodReviews[1]).toMatchObject({ result: 'not_yet', resultLabel: 'まだ', note: 'まだ痛む', exercise: 'ベンチプレス' });
    // occurred には入らない（期間より前に痛めた）
    expect(r.occurred).toEqual([]);
  });

  test('reviewed の並び：いちばん新しい期間の振り返りの日の新しい順', () => {
    const r = classifyInjuriesForPeriod([
      inj('old-review', { occurredOn: '2026-10-01' }),
      inj('new-review', { occurredOn: '2026-10-02' }),
    ], [
      rev('r1', 'old-review', '2026-11-03'),
      rev('r2', 'new-review', '2026-11-06'),
    ], START, END);
    expect(r.reviewed.map((e) => e.id)).toEqual(['new-review', 'old-review']);
  });

  test('fixing：end の時点で直している途中。期間の後に直せたものも含み、期間の後に痛めたもの・期間内に直せたものは含まない', () => {
    const r = classifyInjuriesForPeriod([
      inj('fixing', { occurredOn: '2026-10-20' }),
      inj('fixed-after', { occurredOn: '2026-11-03', status: 'fixed', fixedOn: '2026-11-10' }),
      inj('fixed-in', { occurredOn: '2026-11-03', status: 'fixed', fixedOn: '2026-11-06' }),
      inj('fixed-before', { occurredOn: '2026-10-01', status: 'fixed', fixedOn: '2026-10-20' }),
      inj('fixed-no-date', { occurredOn: '2026-10-01', status: 'fixed', fixedOn: null }),
      inj('not-yet', { occurredOn: '2026-11-09' }),
    ], [], START, END);
    expect(r.fixing.map((e) => e.id)).toEqual(['fixing', 'fixed-after']);
    expect(r.fixingTotal).toBe(2);
    // end 時点の状態：期間の後に直せたケガは、end 時点では直している途中。今の状態は fixed のまま持つ
    const after = r.fixing.find((e) => e.id === 'fixed-after')!;
    expect(after.status).toBe('fixing');
    expect(after.statusLabel).toBe('直している途中');
    expect(after.currentStatus).toBe('fixed');
    expect(after.fixedOn).toBe('2026-11-10');
  });

  test('statusAtPeriodEnd / isFixingAtPeriodEnd：直せた日と end の前後で決まる', () => {
    expect(statusAtPeriodEnd({ status: 'fixed', fixedOn: END }, END)).toBe('fixed');
    expect(statusAtPeriodEnd({ status: 'fixed', fixedOn: '2026-11-09' }, END)).toBe('fixing');
    expect(statusAtPeriodEnd({ status: 'fixing', fixedOn: null }, END)).toBe('fixing');
    expect(statusAtPeriodEnd({ status: 'fixed', fixedOn: null }, END)).toBe('fixed');
    expect(isFixingAtPeriodEnd({ occurredOn: END, status: 'fixing', fixedOn: null }, END)).toBe(true);
    expect(isFixingAtPeriodEnd({ occurredOn: '2026-11-09', status: 'fixing', fixedOn: null }, END)).toBe(false);
  });

  test('1件が複数の分類に入る（期間に痛めて、振り返って、まだ直している途中）', () => {
    const r = classifyInjuriesForPeriod([inj('a', { reviewCount: 1 })], [rev('r1', 'a', '2026-11-07')], START, END);
    expect(r.occurred.map((e) => e.id)).toEqual(['a']);
    expect(r.reviewed.map((e) => e.id)).toEqual(['a']);
    expect(r.fixing.map((e) => e.id)).toEqual(['a']);
    expect(injuryPeriodInjuryCount(r)).toBe(1);
  });

  test('記録がなければ3分類とも空で、読み上げはそのことを言う', () => {
    const r = classifyInjuriesForPeriod([inj('a', { occurredOn: '2026-10-01', status: 'fixed', fixedOn: '2026-10-20' })], [], START, END);
    expect([r.occurredTotal, r.reviewedTotal, r.fixingTotal]).toEqual([0, 0, 0]);
    expect(injuryPeriodInjuryCount(r)).toBe(0);
    expect(injuryPeriodReportLabel(r)).toBe('ケガの振り返り、11月2日から11月8日。この期間のケガの記録はありません');
  });

  test('読み上げのまとめ：分類ごとの件数（0件の分類は言わない）', () => {
    const r = classifyInjuriesForPeriod([inj('a', { reviewCount: 1 })], [rev('r1', 'a', '2026-11-07')], START, END);
    expect(injuryPeriodReportLabel(r)).toBe(
      'ケガの振り返り、11月2日から11月8日。この期間に痛めたもの1件、振り返り1件、直している途中1件',
    );
  });
});
