import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { LayoutAnimationConfig, useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { DateKey, monthMatrix, WEEKDAY_EN } from '@/lib/date';
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
  /** 塗りつぶす日（選んだ日）。なければ今日を塗る */
  selected?: DateKey | null;
  onPressDay?: (key: DateKey) => void;
  /** これより後の日は押せない（薄く出す）。未来の日を選ばせないため */
  maxDate?: DateKey;
  cell?: number;
  testID?: string;
};

/** 英語の月のカレンダー（日曜始まり） */
export function MonthCalendar({ year, month, today, marked, selected, onPressDay, maxDate, cell = 36, testID }: Props) {
  const rows = monthMatrix(year, month);
  const filled = selected === undefined ? today : selected;
  // 選んだ日の緑の丸は、選び直すと中から広がる。初めて出すときは広げない（skipEntering）
  const reduced = useReducedMotion();
  const grow = reduced ? undefined : ZoomIn.duration(duration.enter).easing(easeOut);
  return (
    <LayoutAnimationConfig skipEntering>
      <View style={{ gap: 6 }} testID={testID}>
        <View style={s.row}>
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
              const fg = !d.inMonth ? colors.line : isAfterMax ? colors.sub : isFilled ? colors.onAccent : isMarked ? colors.accent : colors.text;
              return (
                <Pressable
                  key={d.key}
                  disabled={!onPressDay || !d.inMonth || isAfterMax}
                  aria-selected={onPressDay ? isFilled : undefined}
                  onPress={() => onPressDay?.(d.key)}
                  accessibilityLabel={isMarked ? `${d.key} 記録あり` : d.key}
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
});
