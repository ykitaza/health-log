import { useState } from 'react';
import { KeyboardTypeOptions, StyleSheet, View } from 'react-native';
import { Input } from '@/components/Input';
import { Shake } from '@/components/motion';
import { T } from '@/components/Text';
import { colors, fonts, isHud, radius, space } from '@/theme';

/**
 * M3 の outlined text field（高さ 56、枠 3.7:1、ラベルは枠の上）。選んでいるときは緑の 2px、間違いは赤の 2px。
 * 欄を離れたとき・確定したときに onDone（保存は呼ぶ側）。数字の欄（アカウントの画面の体の情報）と表示名の欄で使う
 */
export function Field({ label, unit, value, shake, onChange, onDone, keyboardType = 'decimal-pad', maxLength }: {
  label: string; unit?: string; value: string; shake: number; onChange: (t: string) => void; onDone: () => void;
  keyboardType?: KeyboardTypeOptions; maxLength?: number;
}) {
  const [focused, setFocused] = useState(false);
  const tone = shake > 0 ? colors.danger : focused ? colors.accent : null;
  return (
    <Shake trigger={shake}>
      <View style={[s.field, tone != null && (isHud ? { borderColor: tone, borderWidth: 2 } : { borderColor: tone, borderBottomWidth: 2 })]}>
        <Input
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); onDone(); }}
          onSubmitEditing={onDone}
          keyboardType={keyboardType}
          maxLength={maxLength}
          placeholder="未設定"
          accessibilityLabel={label}
          style={s.fieldInput}
        />
        {unit != null && <T variant="bodyM" color={colors.sub}>{unit}</T>}
        <View style={s.fieldLabel} pointerEvents="none">
          <T variant="bodyS" color={tone ?? colors.sub}>{label}</T>
        </View>
      </View>
    </Shake>
  );
}

/**
 * クラシックの欄は帳の記入欄：枠で囲まず、下の罫だけ（選んでいるときは 2px）。ラベルは欄の上の左に置く（高さは 56 のまま）
 */
export const CLASSIC_FIELD = {
  field: { flexDirection: 'row', alignItems: 'center', height: 56, borderBottomWidth: 1, borderColor: colors.outline, paddingTop: 16, gap: space.s },
  fieldInput: { height: 40 },
  fieldLabel: { position: 'absolute', top: 0, left: 0 },
} as const;

const s = StyleSheet.create({
  field: isHud
    ? { flexDirection: 'row', alignItems: 'center', height: 56, borderWidth: 1, borderColor: colors.outline, borderRadius: radius.input, paddingHorizontal: space.l, gap: space.s }
    : CLASSIC_FIELD.field,
  fieldInput: { flex: 1, minWidth: 0, height: isHud ? 52 : CLASSIC_FIELD.fieldInput.height, color: colors.text, fontFamily: fonts.regular, fontSize: 16 },
  fieldLabel: isHud ? { position: 'absolute', top: -9, left: 12, paddingHorizontal: 4, backgroundColor: colors.card } : CLASSIC_FIELD.fieldLabel,
});
