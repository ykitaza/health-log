/**
 * 「今日」を持ち、日付が変わったら知らせる。画面は開いたまま日をまたぐことがある（アプリを閉じずに夜を越すなど）ので、
 * 描いたときに一度だけ決めた今日を使い続けると、前の日を「今日」として出し、そこへ記録を足してしまう。
 * 0時にタイマーで確かめるほか、前面に戻したときなど（check）にも確かめる（裏にいるあいだはタイマーが動かないことがある）
 */
import { DateKey, msUntilNextDay, todayKey } from './date';

export function watchToday(onChange: (next: DateKey, prev: DateKey) => void) {
  let today = todayKey();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    // 0時の少しあとに確かめる（早く動いても、次のタイマーで拾う）
    timer = setTimeout(() => { timer = null; check(); }, msUntilNextDay(new Date()) + 1000);
  };

  function check() {
    if (stopped) return;
    const next = todayKey();
    if (next !== today) {
      const prev = today;
      today = next;
      onChange(next, prev);
    }
    schedule();
  }

  schedule();
  return {
    get today() { return today; },
    check,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Android の戻るで、今日でない日を見ているなら今日に戻す。戻るを使ったら true（アプリを閉じない） */
export function backToToday(isToday: boolean, goToday: () => void): boolean {
  if (isToday) return false;
  goToday();
  return true;
}
