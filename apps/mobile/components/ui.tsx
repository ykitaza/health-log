import { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { formatJpDate } from '@/lib/date';
import { colors, radius } from '@/theme';
import { Icon, IconName } from './Icon';
import { T } from './Text';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
};

export function Button({ label, onPress, variant = 'primary', icon, disabled, style, small }: ButtonProps) {
  const bg = { primary: colors.accent, secondary: colors.input, danger: colors.dangerDark, outline: 'transparent' }[variant];
  const fg = { primary: colors.onAccent, secondary: colors.text, danger: colors.danger, outline: colors.text }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1, minHeight: small ? 44 : 56 },
        variant === 'outline' && { borderWidth: 1, borderColor: colors.line },
        style,
      ]}
    >
      {icon && <Icon name={icon} color={fg} size={small ? 18 : 20} />}
      <T bold size={small ? 13 : 15} color={fg} numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1 }}>{label}</T>
    </Pressable>
  );
}

export function IconButton({ name, onPress, label, color = colors.text, bg = colors.card, size = 44 }: {
  name: IconName; onPress: () => void; label: string; color?: string; bg?: string; size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 }]}
    >
      <Icon name={name} color={color} size={Math.round(size * 0.48)} />
    </Pressable>
  );
}

/** 戻るボタンと見出し */
export function Header({ title, subtitle, onBack, right, overline }: {
  title: string; subtitle?: string; overline?: string; onBack?: () => void; right?: ReactNode;
}) {
  return (
    <View style={s.header}>
      {onBack && <IconButton name="back" label="戻る" onPress={onBack} />}
      <View style={{ flex: 1 }}>
        {overline && <T size={12} color={colors.sub}>{overline}</T>}
        <T bold size={overline ? 20 : 22} numberOfLines={1}>{title}</T>
        {subtitle && <T size={12} color={colors.sub}>{subtitle}</T>}
      </View>
      {right}
    </View>
  );
}

/**
 * 記録する日が今日でないときの知らせ（記録の画面の上）。過去の日なら、その日に記録していることを、
 * 未来の日なら記録できないことを出す。今日なら何も出さない
 */
export function DayNote({ date, today }: { date: string; today: string }) {
  if (date === today) return null;
  const future = date > today;
  return (
    <View style={[s.dayNote, future ? { backgroundColor: colors.dangerDark } : { backgroundColor: colors.accentDark }]}>
      <Icon name="calendar" size={16} color={future ? colors.danger : colors.accent} />
      <T size={13} bold color={future ? colors.danger : colors.accent} style={{ flexShrink: 1 }}>
        {future ? '未来の日には記録できません' : `過去の日（${formatJpDate(date)}）に記録しています`}
      </T>
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-selected={!!active}
      onPress={onPress}
      style={[s.chip, active ? { backgroundColor: colors.accentDark, borderColor: colors.accent } : { backgroundColor: colors.input, borderColor: colors.input }]}
    >
      <T size={13} bold={active} color={active ? colors.accent : colors.sub}>{label}</T>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
      {children}
    </ScrollView>
  );
}

/** 2〜5個の切り替え */
export function Segmented<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={s.segment}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            aria-selected={active}
            onPress={() => onChange(o.key)}
            style={[s.segmentItem, active && { backgroundColor: colors.input }]}
          >
            <T size={13} bold={active} color={active ? colors.text : colors.sub}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({ icon = 'dumbbell', title, body }: { icon?: IconName; title: string; body?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color={colors.sub} size={30} />
      </View>
      <T bold size={16}>{title}</T>
      {body && <T size={13} color={colors.sub} align="center">{body}</T>}
    </View>
  );
}

/** 確認のダイアログ */
export function ConfirmDialog({ visible, title, body, confirmLabel, onConfirm, onCancel, danger = true }: {
  visible: boolean; title: string; body?: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <View style={s.dialog}>
          <T bold size={17}>{title}</T>
          {body && <T size={13} color={colors.sub} style={{ lineHeight: 20 }}>{body}</T>}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <Button label="キャンセル" variant="secondary" onPress={onCancel} style={{ flex: 1 }} small />
            <Button label={confirmLabel} variant={danger ? 'danger' : 'primary'} onPress={onConfirm} style={{ flex: 1 }} small />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** 一覧の行（右に矢印） */
export function ListRow({ title, subtitle, right, onPress, dim, first, chevron = true }: {
  title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; dim?: boolean; first?: boolean; chevron?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [s.row, !first && s.rowLine, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={{ flex: 1, opacity: dim ? 0.45 : 1 }}>
        <T bold size={16}>{title}</T>
        {subtitle ? <T size={12} color={colors.sub}>{subtitle}</T> : null}
      </View>
      {right}
      {onPress && chevron && <Icon name="chevron" color={colors.sub} size={18} />}
    </Pressable>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 }}>
      <T bold size={13} color={colors.sub}>{title}</T>
      {right && <T size={12} color={colors.sub}>{right}</T>}
    </View>
  );
}

export function Badge({ label, color = colors.accent, bg = colors.accentDark }: { label: string; color?: string; bg?: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
      <T size={12} bold color={color}>{label}</T>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, paddingHorizontal: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  dayNote: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 4 },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, padding: 4 },
  segmentItem: { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 360, backgroundColor: colors.card, borderRadius: 18, padding: 20, gap: 8, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, minHeight: 60 },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
});

/** セットの番号の丸 */
export function SetNo({ n, active }: { n: number; active?: boolean }) {
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: active ? colors.accentDark : colors.input, alignItems: 'center', justifyContent: 'center' }}>
      <T num bold size={12} color={active ? colors.accent : colors.sub}>{n}</T>
    </View>
  );
}
