import { View } from 'react-native';
import { GrowBar, RollNumber } from '@/components/motion';
import { T } from '@/components/Text';
import { Gap, Nutrition } from '@/lib/meals';
import { fmt1, fmtInt } from '@/lib/units';
import { colors } from '@/theme';

/** 進み具合の棒（目標がなければ出さない） */
export function Bar({ value, target, height = 8 }: { value: number; target: number | null; height?: number }) {
  if (target == null || target <= 0) return <View style={{ height }} />;
  const ratio = Math.min(1, Math.max(0, value / target));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: colors.input, overflow: 'hidden' }}>
      <GrowBar ratio={ratio} style={{ height, borderRadius: height / 2, backgroundColor: value > target ? colors.star : colors.accent }} />
    </View>
  );
}

const PFC: { key: 'protein_g' | 'fat_g' | 'carbs_g'; letter: string; label: string }[] = [
  { key: 'protein_g', letter: 'P', label: 'たんぱく質' },
  { key: 'fat_g', letter: 'F', label: '脂質' },
  { key: 'carbs_g', letter: 'C', label: '炭水化物' },
];

/** 残り（負なら「超過」）。数字の桁だけを入れ替えて動かす */
function Remain({ r, unit, fmt = fmt1, size, bold, color }: { r: number; unit: string; fmt?: (n: number) => string; size: number; bold?: boolean; color: string }) {
  return r >= 0
    ? <RollNumber value={fmt(r)} prefix="残り " suffix={unit} size={size} bold={bold} color={color} />
    : <RollNumber value={fmt(-r)} suffix={`${unit} 超え`} size={size} bold={bold} color={color} />;
}

/** 合計（kcal と PFC）、目標、残り。目標がない項目は合計だけ */
export function NutritionSummary({ total, target, remaining }: { total: Nutrition; target: Gap | null; remaining: Gap | null }) {
  return (
    <View testID="meal-summary">
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <RollNumber num bold size={44} testID="total-kcal" value={fmtInt(total.kcal)} />
          <T size={14} color={colors.sub}>{target?.kcal != null ? `/ ${fmtInt(target.kcal)} kcal` : 'kcal'}</T>
        </View>
        {remaining?.kcal != null && <Remain r={remaining.kcal} unit="kcal" fmt={fmtInt} size={13} bold color={remaining.kcal >= 0 ? colors.accent : colors.star} />}
      </View>
      <View style={{ marginTop: 8 }}><Bar value={total.kcal} target={target?.kcal ?? null} /></View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
        {PFC.map((p) => {
          const t = target?.[p.key] ?? null;
          const r = remaining?.[p.key] ?? null;
          return (
            <View key={p.key} style={{ flex: 1, gap: 4 }} accessibilityLabel={`${p.label} ${fmt1(total[p.key])}g${t != null ? ` 目標 ${fmt1(t)}g` : ''}`}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <T num bold size={16} color={colors.accent}>{p.letter}</T>
                <T size={12} color={colors.sub}>{p.label}</T>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
                <RollNumber num bold size={20} value={fmt1(total[p.key])} />
                <T size={11} color={colors.sub}>{t != null ? `/ ${fmt1(t)}g` : 'g'}</T>
              </View>
              <Bar value={total[p.key]} target={t} height={6} />
              {r != null && <Remain r={r} unit="g" size={11} color={r >= 0 ? colors.sub : colors.star} />}
            </View>
          );
        })}
      </View>
    </View>
  );
}
