import { dayLabel } from '../MonthCalendar';

// カレンダーの日の読み上げ（TalkBack）。「2026-11-05」と数字を読ませない
describe('カレンダーの日の読み上げの名前', () => {
  test('日付は「11月5日（木）」の形', () => {
    expect(dayLabel('2026-11-05', {})).toBe('11月5日（木）');
  });
  test('今日と記録ありを添える', () => {
    expect(dayLabel('2026-11-08', { today: true, marked: true })).toBe('11月8日（日） 今日 記録あり');
    expect(dayLabel('2026-11-03', { marked: true })).toBe('11月3日（火） 記録あり');
  });
});
