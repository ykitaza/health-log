// 睡眠・心拍の表示（体組成のタブ）

/** 分を「7時間12分」に（1時間未満は「45分」） */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m}分` : m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/** 時刻（ISO 8601）を、端末の時刻で「6:55」に */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
