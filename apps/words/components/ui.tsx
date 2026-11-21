import { ReactNode } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, TextProps, TextStyle,
  View, ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius, space, TOUCH } from '@/theme';
import { Icon, IconName } from './Icon';

/**
 * Figma「ことば/部品」の部品。文字（T）、ボタン、チップと札、トグル、見出し、シート、確認。
 * 表現（ことば）は明朝（Shippori Mincho）、画面の文字はゴシック（Noto Sans JP）
 */
type Variant = 'page' | 'wordXL' | 'wordL' | 'word' | 'wordS' | 'body' | 'bodyS' | 'label' | 'caption' | 'section';

const VARIANTS: Record<Variant, TextStyle> = {
  /** 画面の見出し（書き留める・拾った） */
  page: { fontFamily: fonts.mincho, fontSize: 28, lineHeight: 40, letterSpacing: 2 },
  /** 答え・詳細の表現 */
  wordXL: { fontFamily: fonts.mincho, fontSize: 40, lineHeight: 56, letterSpacing: 2 },
  /** 入力中の表現 */
  wordL: { fontFamily: fonts.mincho, fontSize: 32, lineHeight: 46, letterSpacing: 1 },
  /** 一覧の表現 */
  word: { fontFamily: fonts.mincho, fontSize: 24, lineHeight: 34, letterSpacing: 1.5 },
  /** 札・例文 */
  wordS: { fontFamily: fonts.mincho, fontSize: 18, lineHeight: 30, letterSpacing: 1 },
  body: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 26 },
  bodyS: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 22 },
  label: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20 },
  section: { fontFamily: fonts.sansBold, fontSize: 15, lineHeight: 22 },
};

/** 1 行が前提の明朝の表現：折り返さず、はみ出すなら 8 割まで小さくする（かなの途中で 1 字だけ次の行に落ちない） */
export const ONE_LINE = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.8 } as const;
/** 複数行になる明朝の文・表現：字間を足さない（狭い幅で 1 字はみ出して、かなの途中で折り返すのを防ぐ） */
export const NO_SPACING = { letterSpacing: 0 } as const;

export function T({ variant = 'body', color = colors.ink, bold, style, ...rest }: TextProps & { variant?: Variant; color?: string; bold?: boolean }) {
  return <Text {...rest} style={[VARIANTS[variant], { color }, bold && { fontFamily: fonts.sansBold }, style]} />;
}

/** 画面の地（安全な余白とスクロール）。footer は下に固定する（ボタンなど） */
export function Screen({ children, scroll = true, footer, testID, contentStyle, inTab }: {
  children: ReactNode; scroll?: boolean; footer?: ReactNode; testID?: string; contentStyle?: StyleProp<ViewStyle>;
  /** 下のタブの中の画面（下の余白はタブが持つ） */
  inTab?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[{ paddingHorizontal: space.xl, paddingBottom: space.xxl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : <View style={[{ flex: 1, paddingHorizontal: space.xl }, contentStyle]}>{children}</View>;
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: insets.top, paddingBottom: inTab ? 0 : insets.bottom }} testID={testID}>
      {body}
      {footer && <View style={{ paddingHorizontal: space.xl, paddingTop: space.m, paddingBottom: space.l }}>{footer}</View>}
    </View>
  );
}

/** 画面の上の行。back があれば左に戻る、title は明朝、right は右に置くもの */
export function Header({ title, count, onBack, right, testID }: {
  title?: string; count?: string; onBack?: () => void; right?: ReactNode; testID?: string;
}) {
  return (
    <View style={s.header} testID={testID}>
      {onBack && <IconButton name="back" label="戻る" onPress={onBack} style={{ marginLeft: -space.m }} />}
      {title != null && (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.m, flexShrink: 1 }}>
          <T variant="page" accessibilityRole="header" {...ONE_LINE}>{title}</T>
          {count != null && <T variant="body" color={colors.sub} numberOfLines={1} style={{ flexShrink: 0 }}>{count}</T>}
        </View>
      )}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function IconButton({ name, label, onPress, color = colors.ink, style, testID, size = 24 }: {
  name: IconName; label: string; onPress: () => void; color?: string; style?: StyleProp<ViewStyle>; testID?: string; size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} hitSlop={4}
      style={({ pressed }) => [s.iconButton, pressed && { opacity: 0.6 }, style]}
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

type ButtonVariant = 'primary' | 'outline' | 'text' | 'plain';

/** ボタン。primary（藍の地）、outline（藍の枠）、text（藍の文字だけ）、plain（薄い枠・墨の文字） */
export function Button({ label, onPress, variant = 'primary', icon, disabled, busy, style, testID, accessibilityLabel, small }: {
  label: string; onPress: () => void; variant?: ButtonVariant; icon?: IconName; disabled?: boolean; busy?: boolean;
  style?: StyleProp<ViewStyle>; testID?: string; accessibilityLabel?: string; small?: boolean;
}) {
  const fg = variant === 'primary' ? colors.onAccent : variant === 'plain' ? colors.ink : colors.accent;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled || !!busy }}
      onPress={onPress} disabled={disabled || busy} testID={testID}
      style={({ pressed }) => [
        s.button, small && s.buttonSmall, BUTTON_STYLES[variant], (disabled || busy) && { opacity: 0.4 }, pressed && { opacity: 0.75 }, style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          {icon && <Icon name={icon} size={20} color={fg} />}
          <T variant={small ? 'bodyS' : 'body'} bold color={fg}>{label}</T>
        </View>
      )}
    </Pressable>
  );
}

const BUTTON_STYLES: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.accent },
  outline: { borderWidth: 1, borderColor: colors.accent },
  text: {},
  plain: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
};

export type ChipVariant = 'default' | 'selected' | 'proposed' | 'confirmed';

/**
 * チップ。default（薄い枠）、selected（灰の地・藍の文字）、proposed（点線。Claude の案）、confirmed（墨の実線。本人が確かめたタグ）。
 * onRemove があれば × を付ける（絞り込みの条件）
 */
export function Chip({ label, onPress, onLongPress, variant = 'default', onRemove, testID, accessibilityLabel, icon }: {
  label: string; onPress?: () => void; onLongPress?: () => void; variant?: ChipVariant; onRemove?: () => void; testID?: string;
  accessibilityLabel?: string; icon?: IconName;
}) {
  const selected = variant === 'selected';
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected }} aria-selected={selected}
      onPress={onRemove ?? onPress} onLongPress={onLongPress} testID={testID} hitSlop={CHIP_SLOP}
      style={({ pressed }) => [s.chip, CHIP_STYLES[variant], pressed && { opacity: 0.7 }]}
    >
      {icon && <Icon name={icon} size={18} color={selected ? colors.accent : colors.ink} />}
      <T variant="body" color={selected ? colors.accent : colors.ink} bold={selected}>{label}</T>
      {onRemove && <Icon name="close" size={16} color={colors.accent} />}
    </Pressable>
  );
}

/** チップの見た目は 40。押せる範囲を縦 48 に（上下 4） */
const CHIP_SLOP = { top: 4, bottom: 4 } as const;

const CHIP_STYLES: Record<ChipVariant, ViewStyle> = {
  default: { borderWidth: 1, borderColor: colors.line },
  selected: { backgroundColor: colors.wash, borderWidth: 1, borderColor: colors.wash },
  proposed: { borderWidth: 1, borderColor: colors.sub, borderStyle: 'dashed' },
  confirmed: { borderWidth: 1, borderColor: colors.ink },
};

/** 丸い ＋（チップの並びの最後） */
export function AddChip({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} hitSlop={4} style={({ pressed }) => [s.addChip, pressed && { opacity: 0.6 }]}>
      <Icon name="plus" size={20} color={colors.sub} />
    </Pressable>
  );
}

/** オン・オフ（藍の地に白い丸 ／ 灰の枠に墨の丸） */
export function Toggle({ value, onChange, label, testID }: { value: boolean; onChange: (v: boolean) => void; label: string; testID?: string }) {
  return (
    <Pressable
      // aria-checked も渡す（web は accessibilityState を aria-checked にしないので、読み上げとテストでオン・オフが分かるように）
      accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} aria-checked={value} onPress={() => onChange(!value)} testID={testID}
      style={s.toggleHit}
    >
      <View style={[s.toggle, value ? { backgroundColor: colors.accent, borderColor: colors.accent } : { borderColor: colors.sub }]}>
        <View style={[s.knob, value ? { alignSelf: 'flex-end', backgroundColor: colors.onAccent, width: 28, height: 28 } : { backgroundColor: colors.sub }]} />
      </View>
    </Pressable>
  );
}

/** 罫線の下の入力欄（本・作品、なぜ残したい？） */
export function Field({ label, style, inputStyle, mincho, ...rest }: TextInputProps & { label: string; inputStyle?: StyleProp<TextStyle>; mincho?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: space.xs, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: space.m }, style]}>
      <T variant="label" color={colors.sub}>{label}</T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.sub}
        {...rest}
        style={[mincho ? VARIANTS.wordS : VARIANTS.body, { color: colors.ink, paddingVertical: space.xs, minHeight: 36 }, inputStyle]}
      />
    </View>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xxl, marginBottom: space.m }}>
      <T variant="section" accessibilityRole="header" style={{ flexShrink: 0 }}>{title}</T>
      {right && <View style={{ flexShrink: 1, marginLeft: space.m }}>{right}</View>}
    </View>
  );
}

/** 下から出るシート（Figma の AI で拾う）。動きを減らす設定ならフェードだけ */
export function Sheet({ visible, onClose, children, testID }: { visible: boolean; onClose: () => void; children: ReactNode; testID?: string }) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {visible && (
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={StyleSheet.absoluteFill}>
            <Pressable accessibilityRole="button" accessibilityLabel="閉じる" style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} onPress={onClose} />
          </Animated.View>
          <Animated.View
            entering={reduced ? FadeIn.duration(150) : SlideInDown.duration(300)}
            exiting={reduced ? FadeOut.duration(150) : SlideOutDown.duration(200)}
            style={[s.sheet, { paddingBottom: space.xl + insets.bottom }]}
            testID={testID}
          >
            <View style={s.handle} />
            {children}
          </Animated.View>
        </View>
      )}
    </Modal>
  );
}

/** 確かめるダイアログ（消すとき） */
export function ConfirmDialog({ visible, title, message, confirmLabel, onConfirm, onCancel }: {
  visible: boolean; title: string; message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, justifyContent: 'center', padding: space.xl }]}>
        <View style={s.dialog} accessibilityRole="alert" testID="confirm-dialog">
          <T variant="wordS">{title}</T>
          <T variant="bodyS" color={colors.sub}>{message}</T>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s, marginTop: space.s }}>
            <Button label="やめる" variant="text" small onPress={onCancel} />
            <Button label={confirmLabel} variant="primary" small onPress={onConfirm} testID="confirm-ok" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** 短い知らせ（下に出す。墨の地に紙の文字） */
export function Notice({ message, testID }: { message: string | null; testID?: string }) {
  if (!message) return null;
  return (
    <View style={s.notice} accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
      <T variant="bodyS" color={colors.paper}>{message}</T>
    </View>
  );
}

/** 名前と値の行（アカウント） */
export function InfoRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={s.infoRow}>
      <T variant="body" color={colors.sub}>{label}</T>
      <T variant="body" testID={testID}>{value}</T>
    </View>
  );
}

/** 押せる行（つなぎ方を見る ›） */
export function LinkRow({ title, sub, onPress, testID }: { title: string; sub?: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} testID={testID}
      style={({ pressed }) => [s.linkRow, pressed && { opacity: 0.6 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="body">{title}</T>
        {sub && <T variant="label" color={colors.sub}>{sub}</T>}
      </View>
      <Icon name="chevronRight" size={20} color={colors.sub} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: 72, paddingTop: space.l, gap: space.s },
  iconButton: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 56, borderRadius: radius.m, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.l },
  buttonSmall: { minHeight: TOUCH, borderRadius: radius.s },
  chip: {
    minHeight: 40, borderRadius: radius.pill, paddingHorizontal: space.l, flexDirection: 'row', alignItems: 'center', gap: space.xs,
    justifyContent: 'center',
  },
  addChip: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  /** 見た目は 56×32。押せる範囲は縦 48 */
  toggleHit: { width: 56, height: TOUCH, justifyContent: 'center' },
  toggle: { width: 56, height: 32, borderRadius: 16, borderWidth: 2, padding: 2, justifyContent: 'center' },
  knob: { width: 16, height: 16, borderRadius: 14, marginHorizontal: 4 },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: space.xl, paddingTop: space.m },
  handle: { alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: colors.faint, marginBottom: space.l },
  dialog: { backgroundColor: colors.paper, borderRadius: radius.l, padding: space.xl, gap: space.m },
  notice: { backgroundColor: colors.ink, borderRadius: radius.s, paddingHorizontal: space.l, paddingVertical: space.m, marginTop: space.m },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: TOUCH, gap: space.l },
  linkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: space.l },
});

export const ui = s;
