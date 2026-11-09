import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { formatJpDate } from '@/lib/date';
import { colors, radius, size as sz, space } from '@/theme';
import { Icon, IconName } from './Icon';
import { ItemLayout, PressableScale, SlidingMark } from './motion';
import { T } from './Text';

/** 使えないものの文字・アイコンの透明度（M3 の 38%） */
const DISABLED_OPACITY = 0.38;

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'tonal' | 'secondary' | 'outline' | 'text' | 'danger';

type ButtonProps = {
  label: string;
  onPress: () => void;
  /**
   * primary：塗り（主な操作）／tonal：薄い緑の塗り／secondary：灰色の塗り（やめる・キャンセルなど）／
   * outline：枠だけ／text：文字だけ／danger：消す・外す（error の色の文字）
   */
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** 高さ 48（M）。ないときは 56（L） */
  small?: boolean;
  testID?: string;
  /** 処理中（保存など）。押せなくし、読み上げで「処理中」と伝える。文言は呼ぶ側で「保存しています…」などに変える */
  busy?: boolean;
  /** 読み上げの名前（並びの中で見た目の文字が同じとき、「ベンチプレスを外す」のように区別する） */
  accessibilityLabel?: string;
};

const BUTTON_BG: Record<ButtonVariant, string> = {
  primary: colors.accent, tonal: colors.accentDark, secondary: colors.input, outline: 'transparent', text: 'transparent', danger: 'transparent',
};
const BUTTON_FG: Record<ButtonVariant, string> = {
  primary: colors.onAccent, tonal: colors.onAccentDark, secondary: colors.text, outline: colors.accent, text: colors.accent, danger: colors.danger,
};

/** M3 の button。角は丸めきる。使えないときは灰色の地と 38% の文字（色だけにしない：押しても反応しない・読み上げで使用不可） */
export function Button({ label, onPress, variant = 'primary', icon, disabled: off, style, small, testID, busy, accessibilityLabel }: ButtonProps) {
  const disabled = off || busy;
  const filled = variant === 'primary' || variant === 'tonal' || variant === 'secondary';
  const bg = disabled && filled ? colors.disabledContainer : BUTTON_BG[variant];
  const fg = disabled ? colors.text : BUTTON_FG[variant];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      aria-busy={!!busy}
      testID={testID}
      style={[
        s.button,
        { backgroundColor: bg, minHeight: small ? sz.buttonM : sz.buttonL, paddingLeft: icon ? 16 : 24 },
        variant === 'outline' && { borderWidth: 1, borderColor: colors.outline },
        style,
      ]}
    >
      <View style={[s.buttonInner, disabled && { opacity: DISABLED_OPACITY }]}>
        {icon && <Icon name={icon} color={fg} size={small ? 20 : 24} />}
        <T variant={small ? 'labelL' : 'titleM'} color={fg} numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1 }}>{label}</T>
      </View>
    </PressableScale>
  );
}

type IconButtonVariant = 'standard' | 'tonal' | 'selected' | 'outlined';

/**
 * M3 の icon button。見た目は 40 の丸、押せる範囲は 48。disabled は押せなくし、読み上げで「使用不可」、アイコンは使えない色。
 * bg を渡すと variant の地より優先する
 */
export function IconButton({ name, onPress, label, color, bg, variant = 'standard', size = sz.iconButton, disabled, testID }: {
  name: IconName; onPress: () => void; label: string; color?: string; bg?: string; variant?: IconButtonVariant; size?: number;
  disabled?: boolean; testID?: string;
}) {
  const base = { standard: 'transparent', tonal: colors.input, selected: colors.accentDark, outlined: 'transparent' }[variant];
  const fg = disabled ? colors.disabled : color ?? (variant === 'selected' ? colors.onAccentDark : colors.text);
  const outer = Math.max(size, sz.touch);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      scaleTo={0.92}
      style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={[
          { width: size, height: size, borderRadius: size / 2, backgroundColor: disabled && (bg ?? base) !== 'transparent' ? colors.disabledContainer : bg ?? base, alignItems: 'center', justifyContent: 'center' },
          variant === 'outlined' && { borderWidth: 1, borderColor: colors.outline },
        ]}
      >
        <Icon name={name} color={fg} size={Math.round(size * 0.6)} />
      </View>
    </PressableScale>
  );
}

/** M3 の small top app bar（高さ 64）。戻るボタンと題。overline と subtitle（補足）は題の上に出す（Figma の TopAppBar） */
export function Header({ title, subtitle, onBack, right, overline }: {
  title: string; subtitle?: string; overline?: string; onBack?: () => void; right?: ReactNode;
}) {
  return (
    <View style={[s.header, !onBack && { paddingLeft: 12 }]}>
      {onBack && <IconButton name="back" label="戻る" onPress={onBack} />}
      <View style={{ flex: 1 }}>
        {(overline || subtitle) && <T variant="bodyS" color={colors.sub} numberOfLines={1}>{[overline, subtitle].filter(Boolean).join(' ・ ')}</T>}
        <T variant="titleL" numberOfLines={1} accessibilityRole="header">{title}</T>
      </View>
      {right}
    </View>
  );
}

/** 設定への入口（どのタブの右上にも置く） */
export function SettingsButton() {
  return <IconButton name="gear" label="設定" onPress={() => router.push('/settings')} testID="open-settings" />;
}

/** タブの画面の上の段（高さ 64）。題（24）と、右に操作（actions）と設定の歯車 */
export function TabHeader({ title, actions, titleNode }: { title: string; actions?: ReactNode; /** 題を文字以外で出すとき（ホームの hlog） */ titleNode?: ReactNode }) {
  return (
    <View style={s.tabHeader}>
      <View style={{ flex: 1 }}>{titleNode ?? <T variant="headlineS" accessibilityRole="header">{title}</T>}</View>
      {actions}
      <SettingsButton />
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
      <Icon name="calendar" size={20} color={future ? colors.onDangerDark : colors.onAccentDark} />
      <T variant="labelL" color={future ? colors.onDangerDark : colors.onAccentDark} style={{ flexShrink: 1 }}>
        {future ? '未来の日には記録できません' : `過去の日（${formatJpDate(date)}）に記録しています`}
      </T>
    </View>
  );
}

/** チップの見た目の高さ。押せる範囲は上下を広げて 48 */
export const CHIP_HEIGHT = 32;

/** M3 の filter chip。選んだものはチェックの印も出す（色だけにしない） */
export function Chip({ label, active, onPress, disabled }: { label: string; active?: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <PressableScale
      accessibilityRole="button"
      aria-selected={!!active}
      onPress={onPress}
      disabled={disabled}
      style={{ minHeight: sz.touch, justifyContent: 'center' }}
    >
      <View
        style={[
          s.chip,
          active ? { backgroundColor: colors.accentDark, borderColor: colors.accentDark, paddingLeft: 8 } : { borderColor: colors.outline },
          disabled && { opacity: DISABLED_OPACITY },
        ]}
      >
        {active && <Icon name="check" size={18} color={colors.onAccentDark} />}
        <T variant="labelL" bold={!!active} color={active ? colors.onAccentDark : colors.sub}>{label}</T>
      </View>
    </PressableScale>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s, paddingRight: space.l }}>
      {children}
    </ScrollView>
  );
}

/** 2〜5個の切り替え（M3 の segmented button）。見た目の高さ 40、押せる範囲 48。選んだものはチェックの印も出す */
export function Segmented<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  // 選んだ印は、選んだものへ横にすべる。大きさが分かるまでは、選んだものの背景に出す
  const [layouts, setLayouts] = useLayouts();
  const mark = layouts[value];
  return (
    <View style={s.segment}>
      <View pointerEvents="none" style={s.segmentFrame}>
        <SlidingMark layout={mark} style={{ top: 0, bottom: 0, backgroundColor: colors.accentDark }} />
      </View>
      {options.map((o, i) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            aria-selected={active}
            onPress={() => onChange(o.key)}
            onLayout={(e) => setLayouts(o.key, e.nativeEvent.layout)}
            style={s.segmentItem}
          >
            <View style={[s.segmentFace, i > 0 && s.segmentDivider, active && !mark && { backgroundColor: colors.accentDark }]}>
              {active && <Icon name="check" size={18} color={colors.onAccentDark} />}
              <T variant="labelL" bold={active} color={active ? colors.onAccentDark : colors.text} numberOfLines={1} style={{ flexShrink: 1 }}>{o.label}</T>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * M3 の primary tabs（タブの画面の中の切り替え：「今日」と「履歴」など）。高さ 48、選んだものは緑の文字と下の線。
 * 下の線は選んだものへ横にすべる（250ms、行き帰り同じ）
 */
export function PrimaryTabs<K extends string>({ options, value, onChange }: { options: { key: K; label: string; icon?: IconName }[]; value: K; onChange: (k: K) => void }) {
  const [layouts, setLayouts] = useLayouts();
  const mark = layouts[value];
  return (
    <View accessibilityRole="tablist" style={s.tabs}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            aria-selected={active}
            onPress={() => onChange(o.key)}
            onLayout={(e) => setLayouts(o.key, e.nativeEvent.layout)}
            style={s.tabItem}
          >
            {o.icon && <Icon name={o.icon} size={24} color={active ? colors.accent : colors.sub} />}
            <T variant="titleS" color={active ? colors.accent : colors.sub}>{o.label}</T>
            {active && !mark && <View style={[s.tabMark, { left: 16, right: 16 }]} />}
          </Pressable>
        );
      })}
      {/* 下の線は文字の幅（左右 16 を除く） */}
      <SlidingMark layout={mark && { x: mark.x + 16, width: mark.width - 32 }} style={s.tabMark} />
    </View>
  );
}

/** 並んだものの位置と幅（key ごと）。選んだ印をすべらせるのに使う */
export function useLayouts(): [Record<string, ItemLayout | undefined>, (key: string, l: ItemLayout) => void] {
  const [layouts, set] = useState<Record<string, ItemLayout | undefined>>({});
  const update = (key: string, { x, width }: ItemLayout) =>
    set((cur) => (cur[key]?.x === x && cur[key]?.width === width ? cur : { ...cur, [key]: { x, width } }));
  return [layouts, update];
}

/** M3 の空の状態：アイコン（88 の丸）、題 22、説明 14、操作は 1 つまで */
export function EmptyState({ icon = 'dumbbell', title, body, action }: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.l, gap: space.s }}>
      <View style={s.emptyIcon}>
        <Icon name={icon} color={colors.sub} size={40} />
      </View>
      <T variant="titleL" align="center" style={{ marginTop: space.s }}>{title}</T>
      {body && <T variant="bodyM" color={colors.sub} align="center">{body}</T>}
      {action && <View style={{ marginTop: space.s, alignSelf: 'stretch' }}>{action}</View>}
    </View>
  );
}

/**
 * 確認のダイアログ（M3 の basic dialog）。題は短く1行（「種目を外しますか？」）、対象の名前は本文に、ボタンは動作の名前。
 * 後ろの画面は 60% の黒で暗くする
 */
export function ConfirmDialog({ visible, title, body, confirmLabel, cancelLabel = 'やめる', onConfirm, onCancel, danger = true, busy }: {
  visible: boolean; title: string; body?: string; confirmLabel: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void; danger?: boolean;
  /** 確かめたあとの処理（消すなど）の途中。どちらのボタンも押せなくする */
  busy?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <View style={s.dialog} accessibilityViewIsModal>
          <T variant="headlineS" accessibilityRole="header">{title}</T>
          {body && <T variant="bodyM" color={colors.sub}>{body}</T>}
          <View style={s.dialogActions}>
            <Button label={cancelLabel} variant="text" onPress={onCancel} disabled={busy} small style={s.dialogButton} />
            <Button label={confirmLabel} variant={danger ? 'danger' : 'text'} onPress={onConfirm} busy={busy} small style={s.dialogButton} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** M3 の list item。1行は高さ 56、2行（subtitle あり）は 72。右に値や矢印 */
export function ListRow({ title, subtitle, right, onPress, dim, first, chevron = true, icon, testID, label }: {
  title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; dim?: boolean; first?: boolean; chevron?: boolean;
  /** 左のアイコン */ icon?: IconName; testID?: string; /** 読み上げの名前（ないときは中の文字） */ label?: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      testID={testID}
      scaleTo={0.98}
      style={[s.row, { minHeight: subtitle ? 72 : 56 }, !first && s.rowLine]}
    >
      {icon && <Icon name={icon} color={colors.sub} size={24} />}
      <View style={{ flex: 1, opacity: dim ? DISABLED_OPACITY : 1 }}>
        <T variant="titleM">{title}</T>
        {subtitle ? <T variant="bodyM" color={colors.sub}>{subtitle}</T> : null}
      </View>
      {right}
      {onPress && chevron && <Icon name="chevron" color={colors.sub} size={24} />}
    </PressableScale>
  );
}

/** 区分けの見出し（14、M3 の titleSmall）。accent なら緑（設定の区分けなど） */
export function SectionTitle({ title, right, accent }: { title: string; right?: string; accent?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: space.l, marginBottom: space.s }}>
      <T variant="titleS" color={accent ? colors.accent : colors.sub} accessibilityRole="header">{title}</T>
      {right && <T variant="bodyS" color={colors.sub}>{right}</T>}
    </View>
  );
}

type BadgeTone = 'primary' | 'neutral' | 'error' | 'star' | 'solid';
const BADGE: Record<BadgeTone, { bg: string; fg: string }> = {
  primary: { bg: colors.accentDark, fg: colors.onAccentDark },
  neutral: { bg: colors.input, fg: colors.sub },
  error: { bg: colors.dangerDark, fg: colors.onDangerDark },
  star: { bg: colors.input, fg: colors.star },
  solid: { bg: colors.accent, fg: colors.onAccent },
};

/** 小さな札（角 8、文字 12）。icon を添えると色だけで伝えない */
export function Badge({ label, tone = 'primary', icon, color, bg }: { label: string; tone?: BadgeTone; icon?: IconName; color?: string; bg?: string }) {
  const fg = color ?? BADGE[tone].fg;
  return (
    <View style={[s.badge, { backgroundColor: bg ?? BADGE[tone].bg }]}>
      {icon && <Icon name={icon} size={14} color={fg} />}
      <T variant="labelM" color={fg}>{label}</T>
    </View>
  );
}

/** M3 の extended FAB（高さ 56、角 16）。画面の右下に置く（置き場所は呼ぶ側） */
export function Fab({ label, icon = 'plus', onPress, testID, style }: { label: string; icon?: IconName; onPress: () => void; testID?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <PressableScale accessibilityRole="button" onPress={onPress} testID={testID} style={[s.fab, style]}>
      <Icon name={icon} size={24} color={colors.onAccent} />
      <T variant="titleM" color={colors.onAccent} numberOfLines={1}>{label}</T>
    </PressableScale>
  );
}

/** M3 の snackbar（明るい地の短い知らせ）。消すのは呼ぶ側（数秒で消す）。action は右に添える操作（「やり直す」など、緑の文字のボタン） */
export function Snackbar({ message, testID, action }: { message: string; testID?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={s.snackbar} accessibilityLiveRegion="polite" testID={testID}>
      <T variant="bodyM" color={colors.card} style={{ flexShrink: 1 }}>{message}</T>
      {action && (
        <PressableScale accessibilityRole="button" accessibilityLabel={`${message}。${action.label}`} onPress={action.onPress} style={s.snackbarAction}>
          <T variant="labelL" color={colors.inverseAccent}>{action.label}</T>
        </PressableScale>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  snackbar: { minHeight: sz.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s, backgroundColor: colors.text, borderRadius: radius.xs, paddingHorizontal: space.l, paddingVertical: space.s },
  // 押せる高さ 48。右の余白は snackbar の余白に重ねて、文字の端を M3 の位置（右から 8）に寄せる
  snackbarAction: { minHeight: sz.touch, justifyContent: 'center', paddingHorizontal: space.s, marginVertical: -space.s, marginRight: -space.s },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: space.l },
  button: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, paddingRight: 24 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: sz.topBar, marginHorizontal: -12 },
  tabHeader: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: sz.topBar, marginRight: -12 },
  dayNote: { flexDirection: 'row', alignItems: 'center', gap: space.s, borderRadius: radius.m, paddingHorizontal: space.l, paddingVertical: space.m, marginTop: space.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l, height: CHIP_HEIGHT, borderRadius: radius.s, borderWidth: 1 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, marginHorizontal: -space.screen },
  tabItem: { flex: 1, minHeight: sz.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s, paddingHorizontal: space.l },
  tabMark: { position: 'absolute', bottom: 0, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: colors.accent },
  segment: { flexDirection: 'row', height: sz.touch },
  segmentFrame: { position: 'absolute', left: 0, right: 0, top: 4, bottom: 4, borderRadius: radius.full, borderWidth: 1, borderColor: colors.outline, overflow: 'hidden' },
  segmentItem: { flex: 1, height: sz.touch, justifyContent: 'center' },
  segmentFace: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s, paddingHorizontal: space.m },
  segmentDivider: { borderLeftWidth: 1, borderLeftColor: colors.outline },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  dialog: { width: '100%', minWidth: 280, maxWidth: 560, backgroundColor: colors.input, borderRadius: radius.dialog, paddingTop: space.xl, paddingHorizontal: space.xl, paddingBottom: space.l, gap: space.l },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.s, paddingTop: space.s },
  dialogButton: { paddingLeft: 12, paddingRight: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingHorizontal: space.l, paddingVertical: space.s },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radius.s, paddingHorizontal: space.s, paddingVertical: space.xs, alignSelf: 'flex-start' },
  fab: { flexDirection: 'row', alignItems: 'center', gap: space.m, height: sz.fab, borderRadius: radius.l, paddingLeft: space.l, paddingRight: 20, backgroundColor: colors.accent, elevation: 3 },
});

/** セットの番号の丸（24） */
export function SetNo({ n, active }: { n: number; active?: boolean }) {
  return (
    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: active ? colors.accentDark : colors.input, alignItems: 'center', justifyContent: 'center' }}>
      <T variant="labelM" color={active ? colors.onAccentDark : colors.sub}>{n}</T>
    </View>
  );
}
