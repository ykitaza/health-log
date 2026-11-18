import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Input } from '@/components/Input';
import { T } from '@/components/Text';
import { Badge, Chip } from '@/components/ui';
import { BIG3_LABELS, BIG3_ROLES, Big3Role } from '@/lib/exercises';
import { colors, fonts, radius, space } from '@/theme';

/**
 * 種目の部位の札（「胸」「背中」。種目と部位の管理で決めた名前をそのまま）。色を増やさず、落ち着いた地に名前の文字で伝える。
 * 高さ 24（上下 4 ＋ labelM の行 16）、左右 8。名前がなければ出さない
 */
export function PartBadge({ name }: { name: string }) {
  if (name.trim() === '') return null;
  return <Badge label={name} color={colors.text} bg={colors.input} />;
}

/** BIG3 に割り当てた種目の名前の横の印 */
export function Big3Badge() {
  return <Badge label="BIG3" tone="primary" />;
}

/**
 * 種目の追加・編集の「BIG3」（なし・ベンチプレス・スクワット・デッドリフト）。
 * 選んだ役を別の種目が持っていれば、その種目から外すことを下に出す（holder はその役を今持っている種目の名前）
 */
export function Big3Field({ value, onChange, holders }: {
  value: Big3Role | null; onChange: (v: Big3Role | null) => void; holders: Partial<Record<Big3Role, string>>;
}) {
  const moving = value ? holders[value] : undefined;
  return (
    <>
      <T size={13} color={colors.sub} style={{ marginTop: 18, marginBottom: 6 }}>BIG3</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.s }}>
        <Chip label="なし" accessibilityLabel="BIG3 なし" active={value == null} onPress={() => onChange(null)} />
        {BIG3_ROLES.map((r) => (
          <Chip key={r} label={BIG3_LABELS[r]} accessibilityLabel={`BIG3 の${BIG3_LABELS[r]}`} active={value === r} onPress={() => onChange(r)} />
        ))}
      </View>
      <T size={12} color={colors.sub} style={{ marginTop: 6 }} testID="big3-note">
        {moving
          ? `「${moving}」から外して、この種目を BIG3 の${BIG3_LABELS[value!]}にします。`
          : '選ぶと、筋トレの推移の「BIG3 の推定1RM（合計）」に入ります'}
      </T>
    </>
  );
}

/** 種目の追加・編集の「フォームの動画（リンク）」。error は https:// でないときなど */
export function FormVideoUrlField({ value, onChange, error }: { value: string; onChange: (t: string) => void; error: string | null }) {
  const [focused, setFocused] = useState(false);
  const tone = error ? colors.danger : focused ? colors.accent : null;
  return (
    <>
      <T size={13} color={colors.sub} style={{ marginTop: 18, marginBottom: 6 }}>フォームの動画（リンク）</T>
      <Input
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="https://youtu.be/…"
        accessibilityLabel="フォームの動画（リンク）"
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        style={[s.input, tone != null && { borderColor: tone, borderWidth: 2 }]}
      />
      <T size={12} color={error ? colors.danger : colors.sub} style={{ marginTop: 6 }}>
        {error ?? 'YouTube などのリンク。記録の入力の画面から開けます'}
      </T>
    </>
  );
}

const s = StyleSheet.create({
  input: {
    height: 52, borderRadius: radius.input, borderWidth: 1, borderColor: colors.outline, color: colors.text,
    fontFamily: fonts.regular, fontSize: 16, paddingHorizontal: 14,
  },
});
