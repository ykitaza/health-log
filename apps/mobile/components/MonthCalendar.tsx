import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { LayoutAnimationConfig, useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { DateKey, dayLabel, monthMatrix, WEEKDAY_EN, WEEKDAY_JA } from '@/lib/date';
import { colors, isHud, radius } from '@/theme';
import { duration } from '@/theme/motion';
import { easeOut } from './motion';
import { T } from './Text';

type Props = {
  year: number;
  month: number; // 1〜12
  today: DateKey;
  /** 印を付ける日（トレーニングした日） */
  marked: Set<DateKey>;
  /** 印の形。ring は緑の丸の枠（ホーム・推移）、dot は濃い緑の丸と数字の下の点（日を選ぶシート） */
  markStyle?: 'ring' | 'dot';
  /** 右上に小さな白い点を付ける日（ホームの、食事を記録した日）。読み上げに「食事の記録あり」を足す */
  dotted?: Set<DateKey>;
  /** 塗りつぶす日（選んだ日）。なければ今日を塗る */
  selected?: DateKey | null;
  onPressDay?: (key: DateKey) => void;
  /** これより後の日は押せない（薄く出す）。未来の日を選ばせないため */
  maxDate?: DateKey;
  /** これより前の日は押せない（薄く出す）。フェーズの開始日を、前のフェーズと重ねないため */
  minDate?: DateKey | null;
  cell?: number;
  /** 週の行どうしの間 */
  rowGap?: number;
  /** 曜日の下に線を引く */
  divider?: boolean;
  /** カレンダー全体の読み上げ（印の意味など）。日のマスは今までどおり1日ずつ選べるよう、まとめない（accessible にしない） */
  accessibilityLabel?: string;
  testID?: string;
};

/** 英語の月のカレンダー（日曜始まり） */
export function MonthCalendar({ year, month, today, marked, markStyle = 'ring', dotted, selected, onPressDay, maxDate, minDate, cell = 36, rowGap = 6, divider = false, accessibilityLabel, testID }: Props) {
  const rows = monthMatrix(year, month);
  const filled = selected === undefined ? today : selected;
  // 選んだ日の緑の丸は、選び直すと中から広がる。初めて出すときは広げない（skipEntering）
  const reduced = useReducedMotion();
  const grow = reduced ? undefined : ZoomIn.duration(duration.enter).easing(easeOut);
  return (
    <LayoutAnimationConfig skipEntering>
      <View style={{ gap: rowGap }} accessibilityLabel={accessibilityLabel} testID={testID}>
        <View style={[s.row, divider && s.divider]}>
          {(isHud ? WEEKDAY_EN : WEEKDAY_JA).map((w) => (
            <View key={w} style={[s.cellBox, { flex: 1, maxWidth: isHud ? cell : Math.max(cell, MIN_CELL) }]}><T num={isHud} size={11} color={colors.sub}>{w}</T></View>
          ))}
        </View>
        {rows.map((row, i) => (
          <View key={i} style={s.row}>
            {row.map((d) => {
              const isFilled = d.key === filled && d.inMonth;
              const isMarked = marked.has(d.key) && d.inMonth;
              const isToday = d.key === today && d.inMonth;
              const isAfterMax = (maxDate != null && d.key > maxDate) || (minDate != null && d.key < minDate);
              const isDotted = (dotted?.has(d.key) ?? false) && d.inMonth;
              const fg = !d.inMonth ? colors.line : isAfterMax ? colors.sub : isFilled ? FILL.fg : isMarked ? colors.accent : colors.text;
              // クラシック：マスは枠で囲まない。選んだ日は墨の四角、今日は墨の枠、記録のある日は数字の下の緑の点（どちらの markStyle も）
              if (!isHud) {
                return (
                  <Pressable
                    key={d.key}
                    disabled={!onPressDay || !d.inMonth || isAfterMax}
                    aria-selected={onPressDay ? isFilled : undefined}
                    onPress={() => onPressDay?.(d.key)}
                    accessibilityRole={onPressDay && d.inMonth ? 'button' : undefined}
                    accessibilityLabel={dayLabel(d.key, { today: isToday, marked: isMarked }) + (isDotted ? ' 食事の記録あり' : '')}
                    importantForAccessibility={d.inMonth ? 'auto' : 'no-hide-descendants'}
                    aria-hidden={!d.inMonth || undefined}
                    testID={d.inMonth ? `day-${d.key}` : undefined}
                    style={[
                      s.cellBox,
                      // 押せる大きさは 44 以上（幅が足りなければ縮むのは HUD と同じ）
                      { flex: 1, maxWidth: Math.max(cell, MIN_CELL), aspectRatio: 1, borderRadius: radius.xs },
                      isToday && !isFilled && { borderWidth: 1, borderColor: colors.text },
                      isFilled && { backgroundColor: FILL.bg },
                    ]}
                  >
                    <T num bold={isFilled || isToday || isMarked} size={15} color={isAfterMax || !d.inMonth ? fg : isFilled ? FILL.fg : colors.text}>{d.day}</T>
                    {isMarked && <View style={[s.markDot, { backgroundColor: isFilled ? FILL.fg : colors.accent }]} />}
                    {isDotted && <View style={s.dot} testID={`meal-dot-${d.key}`} />}
                  </Pressable>
                );
              }
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
                    // マスの枠は今日と記録のある日だけ（ほかの日は透明の枠。大きさは変えない）
                    d.inMonth && { borderWidth: 1, borderColor: 'transparent' },
                    isMarked && (markStyle === 'ring'
                      ? { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentDark }
                      : { borderColor: colors.accentDark, backgroundColor: colors.accentDark }),
                    isToday && !isFilled && !isMarked && { borderColor: colors.text },
                    isFilled && { borderColor: colors.accent },
                  ]}
                >
                  {isFilled && <Animated.View entering={grow} style={[StyleSheet.absoluteFill, { borderRadius: cell / 2, backgroundColor: FILL.bg }]} />}
                  <T num bold size={15} color={markStyle === 'dot' && isMarked && !isFilled ? colors.text : fg}>{d.day}</T>
                  {markStyle === 'dot' && isMarked && <View style={[s.markDot, { backgroundColor: isFilled ? colors.onAccent : colors.accent }]} />}
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

/** クラシックのマスの最小の大きさ（押せる大きさ） */
const MIN_CELL = 44;

/** 選んだ日の地と文字。HUD は緑、クラシックは墨の地に紙の文字（components/ui の選んだものと同じ） */
const FILL = isHud ? { bg: colors.accent, fg: colors.onAccent } : { bg: colors.text, fg: colors.bg };

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cellBox: { alignItems: 'center', justifyContent: 'center' },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 4 },
  markDot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2 },
  dot: { position: 'absolute', top: -3, right: -3, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.bg, backgroundColor: colors.text },
});
