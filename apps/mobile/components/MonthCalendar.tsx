import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { LayoutAnimationConfig, useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { DateKey, dayLabel, monthMatrix, WEEKDAY_EN } from '@/lib/date';
import { colors } from '@/theme';
import { duration } from '@/theme/motion';
import { easeOut } from './motion';
import { T } from './Text';

type Props = {
  year: number;
  month: number; // 1〜12
  today: DateKey;
  /** 印を付ける日（トレーニングした日） */
  marked: Set<DateKey>;
  /** 右上に小さな白い点を付ける日（ホームの、食事を記録した日）。読み上げに「食事の記録あり」を足す */
  dotted?: Set<DateKey>;
  /** 塗りつぶす日（選んだ日）。なければ今日を塗る */
  selected?: DateKey | null;
  onPressDay?: (key: DateKey) => void;
  /** これより後の日は押せない（薄く出す）。未来の日を選ばせないため */
  maxDate?: DateKey;
  cell?: number;
  /** 週の行どうしの間 */
  rowGap?: number;
  /** 曜日の下に線を引く */
  divider?: boolean;
  testID?: string;
};

/** 英語の月のカレンダー（日曜始まり） */
export function MonthCalendar({ year, month, today, marked, dotted, selected, onPressDay, maxDate, cell = 36, rowGap = 6, divider = false, testID }: Props) {
  const rows = monthMatrix(year, month);
  const filled = selected === undefined ? today : selected;
  // 選んだ日の緑の丸は、選び直すと中から広がる。初めて出すときは広げない（skipEntering）
  const reduced = useReducedMotion();
  const grow = reduced ? undefined : ZoomIn.duration(duration.enter).easing(easeOut);
  return (
    <LayoutAnimationConfig skipEntering>
      <View style={{ gap: rowGap }} testID={testID}>
        <View style={[s.row, divider && s.divider]}>
          {WEEKDAY_EN.map((w) => (
            <View key={w} style={[s.cellBox, { flex: 1, maxWidth: cell }]}><T num size={11} color={colors.sub}>{w}</T></View>
          ))}
        </View>
        {rows.map((row, i) => (
          <View key={i} style={s.row}>
            {row.map((d) => {
              const isFilled = d.key === filled && d.inMonth;
              const isMarked = marked.has(d.key) && d.inMonth;
              const isToday = d.key === today && d.inMonth;
              const isAfterMax = maxDate != null && d.key > maxDate;
              const isDotted = (dotted?.has(d.key) ?? false) && d.inMonth;
              const fg = !d.inMonth ? colors.line : isAfterMax ? colors.sub : isFilled ? colors.onAccent : isMarked ? colors.accent : colors.text;
              return (
                <Pressable
                  key={d.key}
                  disabled={!onPressDay || !d.inMonth || isAfterMax}
                  aria-selected={onPressDay ? isFilled : undefined}
                  onPress={() => onPressDay?.(d.key)}
                  accessibilityRole={onPressDay && d.inMonth ? 'button' : undefined}
                  accessibilityLabel={dayLabel(d.key, { today: isToday, marked: isMarked }) + (isDotted ? ' 食事の記録あり' : '')}
                  // 月の外の日（薄く出すだけ）は読ませない
                  importantForAccessibility={d.inMonth ? 'auto' : 'no-hide-descendants'}
                  aria-hidden={!d.inMonth || undefined}
                  testID={d.inMonth ? `day-${d.key}` : undefined}
                  style={[
                    s.cellBox,
                    // 幅が足りなければ縮める（360 の幅など）。足りれば cell の大きさ
                    { flex: 1, maxWidth: cell, aspectRatio: 1, borderRadius: cell / 2 },
                    d.inMonth && { borderWidth: 1, borderColor: colors.line },
                    isMarked && { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentDark },
                    isToday && !isFilled && !isMarked && { borderColor: colors.text },
                    isFilled && { borderColor: colors.accent },
                  ]}
                >
                  {isFilled && <Animated.View entering={grow} style={[StyleSheet.absoluteFill, { borderRadius: cell / 2, backgroundColor: colors.accent }]} />}
                  <T num bold size={15} color={fg}>{d.day}</T>
                  {/* 今日や筋トレの日の丸の上でも見えるよう、背景の色の縁を付ける */}
                  {isDotted && <View style={s.dot} testID={`meal-dot-${d.key}`} />}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </LayoutAnimationConfig>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cellBox: { alignItems: 'center', justifyContent: 'center' },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 4 },
  dot: { position: 'absolute', top: -3, right: -3, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.bg, backgroundColor: colors.text },
});
