// 睡眠・心拍の表示（からだのタブ、ホームの体調のカード）

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

/** 心拍のまとめを「安静時 58 ・ 平均 72（52〜140）拍/分」に（ない値は出さない） */
export function formatHeartRate(h: { restingBpm: number | null; avgBpm: number | null; minBpm: number | null; maxBpm: number | null }): string {
  const r = (n: number) => String(Math.round(n));
  const parts: string[] = [];
  if (h.restingBpm != null) parts.push(`安静時 ${r(h.restingBpm)}`);
  if (h.avgBpm != null) parts.push(`平均 ${r(h.avgBpm)}${h.minBpm != null && h.maxBpm != null ? `（${r(h.minBpm)}〜${r(h.maxBpm)}）` : ''}`);
  return `${parts.join(' ・ ')} 拍/分`;
}
