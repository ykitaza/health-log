import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Input } from '@/components/Input';
import { T } from '@/components/Text';
import { Card, Chip } from '@/components/ui';
import { parseRatioPct, RATIO_CHIPS } from '@/lib/bodyweight';
import { colors, fonts, radius, space } from '@/theme';

/**
 * 回数だけの種目の「体重に対する割合」（%）。種目の追加・編集の画面で、記録のしかたが「回数だけ」のときに出す。
 * 自重の負荷量 ＝ その日の体重 × 割合 × 回数。0% なら負荷量に入れない（プランクなど）
 */
export function BodyweightRatioField({ value, onChange, invalid }: { value: string; onChange: (t: string) => void; invalid: boolean }) {
  const [focused, setFocused] = useState(false);
  const pct = parseRatioPct(value);
  const tone = invalid ? colors.danger : focused ? colors.accent : null;
  return (
    <>
      <T size={13} color={colors.sub} style={{ marginTop: 18, marginBottom: 6 }}>体重に対する割合</T>
      <Card>
        <View style={[s.field, tone != null && { borderColor: tone, borderWidth: 2 }]}>
          <Input
            value={value}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            keyboardType="decimal-pad"
            placeholder="65"
            accessibilityLabel="体重に対する割合（%）"
            style={s.input}
          />
          <T variant="bodyL" color={colors.sub}>%</T>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.s, marginTop: space.s }}>
          {RATIO_CHIPS.map((c) => <Chip key={c} label={`${c}%`} active={pct === c} onPress={() => onChange(String(c))} />)}
        </View>
        <T size={12} color={invalid ? colors.danger : colors.sub} style={{ marginTop: space.s }}>
          {invalid
            ? '0〜100 の数で入れてください'
            : pct === 0
              ? '0% なので、この種目は負荷量に入れません（プランクなど）'
              : '負荷量 ＝ その日の体重 × 割合 × 回数。0% なら負荷量に入れません'}
        </T>
      </Card>
    </>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', height: 56, borderWidth: 1, borderColor: colors.outline, borderRadius: radius.input, paddingHorizontal: space.l, gap: space.s },
  input: { flex: 1, minWidth: 0, height: 52, color: colors.text, fontFamily: fonts.regular, fontSize: 16 },
});
