// フェーズの食事の目標の入力（筋トレの日・休みの日の kcal と、1 日のたんぱく質）。設定のステップ 3 と、進捗の詳細の「食事の目標」で使う
import { View } from 'react-native';
import { MealDraft } from '@/lib/phaseView';
import { parseNumber } from '@/lib/units';
import { hud } from '../report/hud';
import { T } from '../Text';
import { NumberField } from './parts';

export function MealFields({ draft, onChange, weightKg }: { draft: MealDraft; onChange: (d: MealDraft) => void; weightKg: number | null }) {
  const protein = parseNumber(draft.protein);
  const perKg = protein != null && weightKg != null && weightKg > 0 ? (protein / weightKg).toFixed(1) : null;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <NumberField label="筋トレの日" unit="kcal" value={draft.training} onChange={(training) => onChange({ ...draft, training })} keyboardType="number-pad" maxLength={5} testID="phase-meal-training" />
        <NumberField label="休みの日" unit="kcal" value={draft.rest} onChange={(rest) => onChange({ ...draft, rest })} keyboardType="number-pad" maxLength={5} testID="phase-meal-rest" />
      </View>
      <NumberField label="たんぱく質（1日）" unit="g" value={draft.protein} onChange={(p) => onChange({ ...draft, protein: p })} maxLength={6} testID="phase-meal-protein" />
      {perKg && <T size={11.5} color={hud.muted}>{`体重 1 kg あたり ${perKg} g`}</T>}
    </View>
  );
}
