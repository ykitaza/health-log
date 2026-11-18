function cell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 見出しと行から CSV を作る（改行は CRLF） */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** 筋トレの記録の CSV の1行（db の exportRows の行） */
export type WorkoutCsvRow = {
  date: string; body_part: string; exercise: string; set_index: number; weight_kg: number | null; reps: number; memo: string; done: number;
};

/** 筋トレの記録の CSV（重さは単位の設定によらず kg） */
export function workoutCsv(rows: WorkoutCsvRow[]): string {
  return toCsv(
    ['日付', '部位', '種目', 'セット', '重量(kg)', '回数', 'メモ', '完了'],
    rows.map((r) => [r.date, r.body_part, r.exercise, r.set_index + 1, r.weight_kg, r.reps, r.memo, r.done ? 1 : 0]),
  );
}
