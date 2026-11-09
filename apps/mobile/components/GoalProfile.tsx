import { View } from 'react-native';
import { T } from '@/components/Text';
import { Chip } from '@/components/ui';
import { ACTIVITIES, ACTIVITY_LABELS, Activity, Sex, SEX_LABELS } from '@/lib/autoGoal';
import { colors, space } from '@/theme';

/** 性別（食事の目標の自動計算に使う）。設定と、食事の目標の画面の両方で使う */
export function SexChoice({ value, onChange }: { value: Sex | null; onChange: (v: Sex) => void }) {
  return (
    <View style={{ gap: space.xs }}>
      <T variant="titleM">性別</T>
      <View style={{ flexDirection: 'row', columnGap: space.s }}>
        {(Object.keys(SEX_LABELS) as Sex[]).map((k) => (
          <Chip key={k} label={SEX_LABELS[k]} active={value === k} onPress={() => onChange(k)} />
        ))}
      </View>
    </View>
  );
}

/** ふだんの活動の量（筋トレの分は含めない） */
export function ActivityChoice({ value, onChange }: { value: Activity | null; onChange: (v: Activity) => void }) {
  return (
    <View style={{ gap: space.xs }}>
      <T variant="titleM">ふだんの活動の量</T>
      <T variant="bodyM" color={colors.sub}>仕事や家事、歩く量。筋トレの分は含めません</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.s }}>
        {ACTIVITIES.map((k) => (
          <Chip key={k} label={ACTIVITY_LABELS[k]} active={value === k} onPress={() => onChange(k)} />
        ))}
      </View>
    </View>
  );
}
