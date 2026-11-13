import { View } from 'react-native';
import { PartBadge } from './ExerciseFields';
import { MuscleFigure } from './MuscleFigure';
import { T } from './Text';
import type { Repositories } from '@/db';
import { DateKey, daysBetween, formatMonthDay } from '@/lib/date';
import { focusByDate, PartLast, partSuggestion } from '@/lib/training';
import { colors, radius, space } from '@/theme';

/**
 * 日ごとの部位と、部位の名前（ID から名前を引く・おすすめに使う、非表示でない部位の名前）を読む。
 * rows を読んであれば渡す（ホームはほかの計算にも使うので二度読まない）
 */
export async function loadPartDays(r: Repositories, rows?: Awaited<ReturnType<Repositories['workouts']['allSetRows']>>) {
  const [setRows, parts] = await Promise.all([rows ?? r.workouts.allSetRows(), r.catalog.listBodyParts({ includeHidden: true })]);
  const nameById = new Map(parts.map((p) => [p.id, p.name]));
  return {
    days: focusByDate(setRows, (id) => nameById.get(id) ?? ''),
    /** 部位の ID → 名前（非表示の部位も） */
    nameById,
    names: parts.filter((p) => !p.hidden).map((p) => p.name),
  };
}
export type PartDays = Awaited<ReturnType<typeof loadPartDays>>;

/** ホームの「今日のトレーニング」のカードの前回（今日より前の最後の筋トレの日の部位と何日前か）と、今日のおすすめ */
export function todaySuggestion(data: PartDays, today: DateKey) {
  const prev = data.days.filter((d) => d.date < today).at(-1) ?? null;
  const { suggest } = partSuggestion(data.days, data.names, today);
  return { prev: prev ? { parts: prev.parts, days: daysBetween(prev.date, today) } : null, suggest };
}

/** ホームの「今日のトレーニング」のカードの2・3行目：「まだ記録なし ・ 前回 [胸] 2日前」「おすすめ [背中] 6日あいている」 */
export function TodaySuggestLines({ s }: { s: ReturnType<typeof todaySuggestion> }) {
  // 幅が足りないときは「前回 [胸] 2日前」「[背中] 6日あいている」をまとめて次の行へ回す（札と日数を離さない）
  const unit = { flexDirection: 'row', alignItems: 'center', gap: space.xs } as const;
  const line = { ...unit, flexWrap: 'wrap', rowGap: 2 } as const;
  return (
    <>
      <View style={line} testID="home-training-prev">
        <T variant="bodyM" color={colors.sub}>まだ記録なし{s.prev ? ' ・' : ''}</T>
        {s.prev && (
          <View style={unit} testID="home-training-prev-part">
            <T variant="bodyM" color={colors.sub}>前回</T>
            {s.prev.parts.map((p) => <PartBadge key={p} name={p} />)}
            <T variant="bodyM" color={colors.sub}>{s.prev.days}日前</T>
          </View>
        )}
      </View>
      {s.suggest && (
        <View style={line} testID="home-training-suggest">
          <T variant="bodyM" bold color={colors.accent}>おすすめ</T>
          <View style={unit}>
            <PartBadge name={s.suggest.name} />
            <T variant="bodyM" color={colors.sub}>{suggestGapText(s.suggest)}</T>
          </View>
        </View>
      )}
    </>
  );
}

const suggestGapText = (p: PartLast) => (p.days == null ? 'まだやっていない' : `${p.days}日あいている`);

/** ホームの「今日のトレーニング」のカードの読み上げ（2・3行目） */
export function todaySuggestionSpoken(s: ReturnType<typeof todaySuggestion>): string {
  return [
    s.prev ? `まだ記録なし、前回 ${s.prev.parts.join('・')} ${s.prev.days}日前` : 'まだ記録なし',
    s.suggest ? `おすすめ ${s.suggest.name} ${suggestGapText(s.suggest)}` : null,
  ].filter(Boolean).join('。');
}

/**
 * ホームのカレンダーの下の「最近の流れ」：直近3回の筋トレの日の部位（古い順）→ 今日。
 * 今日がまだなら今日のおすすめを点線の枠で薄く、今日やっていれば今日の部位を普通の枠で。部位はその日のいちばん多い部位を
 * 筋肉の図（縦長の四角 31×51 の中に、その部位の筋肉を緑で塗った体）で。前の日も今日のおすすめもなければ出さない
 */
export function RecentPartFlow({ past, today, suggest }: { past: { date: DateKey; parts: string[] }[]; today: string[] | null; suggest: string | null }) {
  const last = today ? { parts: today, planned: false } : suggest ? { parts: [suggest], planned: true } : null;
  if (past.length === 0 && !last) return null;
  const spoken = [
    '最近の部位の流れ',
    past.map((d) => `${formatMonthDay(d.date)} ${d.parts.join('・')}`).join('、'),
    last ? (last.planned ? `今日のおすすめは${last.parts[0]}` : `今日 ${last.parts.join('・')}`) : '',
  ].filter(Boolean).join('。');
  const items = [...past.map((d) => ({ key: d.date, parts: d.parts, planned: false })), ...(last ? [{ key: 'today', ...last }] : [])];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.s }} accessible accessibilityLabel={spoken} testID="recent-flow">
      <T variant="bodyS" color={colors.sub} numberOfLines={1} style={{ marginRight: 2, flexShrink: 0 }}>最近</T>
      {items.map((it, i) => (
        <View key={it.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
          {i > 0 && <T variant="bodyS" color={colors.sub}>→</T>}
          <View
            testID={it.planned ? 'recent-flow-planned' : 'recent-flow-day'}
            style={{
              // 幅が足りなければ幅だけ縮める（360 の幅など）。図の幅 23.5 は残す
              width: 31, height: 51, flexShrink: 1, minWidth: 24, borderRadius: radius.s, alignItems: 'center', justifyContent: 'center',
              backgroundColor: it.planned ? undefined : colors.input,
              borderWidth: it.planned ? 1 : 0, borderColor: colors.outline, borderStyle: 'dashed', opacity: it.planned ? 0.6 : 1,
            }}
          >
            <MuscleFigure name={it.parts[0]} width={23.5} height={47} />
          </View>
        </View>
      ))}
    </View>
  );
}
