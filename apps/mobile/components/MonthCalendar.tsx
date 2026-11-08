import { Pressable, StyleSheet, View } from 'react-native';
import { DateKey, monthMatrix, WEEKDAY_EN } from '@/lib/date';
import { colors } from '@/theme';
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
  cell?: number;
};

/** 英語の月のカレンダー（日曜始まり） */
export function MonthCalendar({ year, month, today, marked, selected, onPressDay, cell = 36 }: Props) {
  const rows = monthMatrix(year, month);
  const filled = selected === undefined ? today : selected;
  return (
    <View style={{ gap: 6 }}>
      <View style={s.row}>
        {WEEKDAY_EN.map((w) => (
          <View key={w} style={[s.cellBox, { width: cell }]}><T num size={11} color={colors.sub}>{w}</T></View>
        ))}
      </View>
      {rows.map((row, i) => (
        <View key={i} style={s.row}>
          {row.map((d) => {
            const isFilled = d.key === filled && d.inMonth;
            const isMarked = marked.has(d.key) && d.inMonth;
            const isToday = d.key === today && d.inMonth;
            const fg = !d.inMonth ? colors.line : isFilled ? colors.onAccent : isMarked ? colors.accent : colors.text;
            return (
              <Pressable
                key={d.key}
                disabled={!onPressDay || !d.inMonth}
                onPress={() => onPressDay?.(d.key)}
                accessibilityLabel={d.key}
                style={[
                  s.cellBox,
                  { width: cell, height: cell, borderRadius: cell / 2 },
                  d.inMonth && { borderWidth: 1, borderColor: colors.line },
                  isMarked && { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentDark },
                  isToday && !isFilled && !isMarked && { borderColor: colors.text },
                  isFilled && { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
              >
                <T num bold size={15} color={fg}>{d.day}</T>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cellBox: { alignItems: 'center', justifyContent: 'center' },
});
