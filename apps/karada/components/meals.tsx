import { ReactNode } from 'react';
import { View } from 'react-native';
import { RollNumber } from '@/components/motion';
import { T } from '@/components/Text';
import { Gap } from '@/lib/meals';
import { fmt1, fmtInt } from '@/lib/units';
import { colors } from '@/theme';

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

/**
 * 目標の残り（kcal と PFC）。合計と目標は、上の FUEL のカード（ホームと同じ）に出すので、ここは残りだけ。目標がない項目は出さない。
 * right は kcal の残りの行の右に置くもの（日の種類の切り替え）
 */
export function NutritionRemaining({ remaining, right }: { remaining: Gap | null; right?: ReactNode }) {
  return (
    <View testID="meal-remaining">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {remaining?.kcal != null
          ? <Remain r={remaining.kcal} unit=" kcal" fmt={fmtInt} size={14} bold color={remaining.kcal >= 0 ? colors.accent : colors.star} />
          : <View />}
        {right}
      </View>
      {PFC.some((p) => remaining?.[p.key] != null) && (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {PFC.map((p) => {
            const r = remaining?.[p.key] ?? null;
            return (
              <View key={p.key} style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 4 }} accessibilityLabel={r == null ? undefined : `${p.label} ${r >= 0 ? `残り ${fmt1(r)}g` : `${fmt1(-r)}g 超え`}`}>
                {r != null && (
                  <>
                    <T num bold size={14} color={colors.accent}>{p.letter}</T>
                    <Remain r={r} unit=" g" size={12} color={r >= 0 ? colors.sub : colors.star} />
                  </>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
