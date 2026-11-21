import { StyleSheet, View } from 'react-native';
import { Card } from '@/components/ui';
import { T } from '@/components/Text';
import { diffText, MealScore, partText, scoreSpeech } from '@/lib/mealScore';
import { colors, isHud, lbl, radius, space } from '@/theme';

/**
 * その日の食事のスコア（0〜100 点。#331）。点・前の日との差・4 つの内訳（記録なしは「記録なし」）と、いちばん伸ばしやすい項目を 1 つ。
 * 点は端末で計算する（lib/mealScore.ts。サーバーと同じ規則）。責めない見せ方にする：前の日より低くても赤くせず、
 * 伸ばしやすい項目は「〜で +N 点」と前向きに出す。今日は「ここまで」の点で、エネルギーとたんぱく質は「1日の終わりに付く」として数えない
（昼に「あと何 kcal」と食べるよう勧めない）。
 * 読み上げは、まとめて 1 つの文（点・差・内訳・伸ばしやすい項目）にする
 */
export function MealScoreCard({ score, diff }: { score: MealScore; diff: number | null }) {
  const soFar = score.inProgress;
  // 推定のない品目（手で入れた品目）がある日は、バランス・控えたいものの項目が記録なしになる。そのわけを一言添える
  const missing = score.parts.some((p) => p.items.some((i) => i.ratio == null) && (p.key === 'balance' || p.key === 'moderation'));
  return (
    <Card style={s.card}>
      <View accessible accessibilityRole="summary" accessibilityLabel={scoreSpeech(score, diff)} testID="meal-score" style={{ gap: space.m }}>
        <View style={s.head}>
          <T variant="labelM" color={colors.sub}>{lbl('SCORE //', '食事のスコア')}</T>
          {isHud && <T variant="labelM" color={colors.sub}>食事のスコア</T>}
          <View style={{ flex: 1 }} />
          {soFar && <T variant="labelM" color={colors.sub}>ここまで</T>}
        </View>
        <View style={s.big}>
          <T variant="numDisplay" testID="meal-score-value">{score.score == null ? '—' : String(score.score)}</T>
          <T variant="labelL" color={colors.sub}>/ 100</T>
          <View style={{ flex: 1 }} />
          {diff != null && (
            <View style={[s.diff, { borderColor: diff > 0 ? colors.accent : colors.outline }]} testID="meal-score-diff">
              <T variant="labelM" color={diff > 0 ? colors.accent : colors.sub}>前の日より {diffText(diff)}</T>
            </View>
          )}
        </View>
        <View style={{ gap: space.s }}>
          {score.parts.map((p) => (
            <View key={p.key} style={s.part}>
              <T variant="bodyS" style={s.partLabel} numberOfLines={1}>{p.label}</T>
              {!p.deferred && (
                <View style={s.track}>
                  {p.points != null && <View style={[s.fill, { width: `${p.points}%` }]} />}
                </View>
              )}
              <T variant={p.points == null ? 'bodyS' : 'labelM'} color={p.points == null ? colors.sub : colors.text} style={p.deferred ? s.partDeferred : s.partValue}>
                {p.deferred ? partText(p) : p.points == null ? '記録なし' : `${p.points}`}
              </T>
            </View>
          ))}
        </View>
        {score.easiest ? (
          <View style={s.next} testID="meal-score-next">
            <T variant="labelM" color={colors.sub}>{lbl('NEXT', 'いちばん伸ばしやすいこと')}</T>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s, flexWrap: 'wrap' }}>
              <T variant="titleS">{score.easiest.item.advice}</T>
              <T variant="labelM" color={colors.accent}>+{score.easiest.gain} 点</T>
            </View>
          </View>
        ) : (
          <T variant="bodyS" color={colors.sub}>記録のある内訳は、どれも満点です</T>
        )}
        {missing && (
          <T variant="bodyS" color={colors.sub}>主食・副菜や食塩などは、AI で記録した食事の推定から数えます。手で入れた品目がある日は「記録なし」にして、点を下げません</T>
        )}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  card: { marginTop: space.l },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: space.s },
  // 差は塗らずに枠だけの小さな札（上がったら主な色、下がった・同じは控えめな灰色。赤は使わない）
  diff: { borderWidth: 1, borderRadius: isHud ? radius.s : radius.xs, paddingHorizontal: space.s, paddingVertical: 2, alignSelf: 'center' },
  part: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 20 },
  partLabel: { width: 84 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: isHud ? colors.input : colors.line, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
  partValue: { width: 56, textAlign: 'right' },
  // 今日のエネルギーとたんぱく質：棒を出さず、「1日の終わりに付く」を右に寄せる
  partDeferred: { flex: 1, textAlign: 'right' },
  // クラシックは上に罫、HUD は一段明るい面
  next: isHud
    ? { gap: 2, backgroundColor: colors.input, borderRadius: radius.m, paddingHorizontal: space.m, paddingVertical: space.s }
    : { gap: 2, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space.s },
});
