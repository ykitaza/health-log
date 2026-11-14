// フェーズの設定（app/phase/new.tsx）と進捗の詳細（app/phase/index.tsx）の見た目の部品。
// 構成は Figma「スタディ：フェーズ」のセクション 2・3、見た目はレポート詳細（components/report/hud.tsx）の文法：
// 近黒の地とパネル、1px の枠、角の切り欠き、等幅の英字のラベル、色はミント 1 色とモノクロ（中断だけ赤）
import { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleProp, useWindowDimensions, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { Input } from '../Input';
import { PressableScale } from '../motion';
import { hud, HudFonts, Micro, Mono, NotchChip, Panel, useMono } from '../report/hud';
import { T } from '../Text';
import { IconButton } from '../ui';

/** 画面の枠：近黒の地、上の段に戻る・英字の行（左 sys、右 right）、中身はスクロール、footer は下に固定 */
export function PhaseFrame({ sys, onBack, right, footer, children, testID }: {
  sys: string; onBack: () => void; right?: ReactNode; footer?: ReactNode; children: ReactNode; testID?: string;
}) {
  const { width } = useWindowDimensions();
  const side = 12 + Math.max(0, (width - 400) / 2);
  return (
    <HudFonts>
      <SafeAreaView style={{ flex: 1, backgroundColor: hud.bg }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: side - 12, minHeight: 48 }}>
          <IconButton name="back" label="戻る" onPress={onBack} bg="transparent" color={hud.muted} size={20} />
          <View style={{ flex: 1, paddingHorizontal: 2 }}><Micro>{sys}</Micro></View>
          {right ?? <View style={{ width: 48 }} />}
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: side, paddingBottom: 24, gap: 8 }} keyboardShouldPersistTaps="handled" testID={testID}>
          {children}
        </ScrollView>
        {footer && <View style={{ paddingHorizontal: side, paddingTop: 8, paddingBottom: 12, gap: 6 }}>{footer}</View>}
      </SafeAreaView>
    </HudFonts>
  );
}

/** 画面の題（緑の英字の小ラベル＋太い和文）と補足 */
export function PhaseTitle({ en, title, note }: { en: string; title: string; note?: string }) {
  return (
    <View style={{ gap: 2, marginTop: 4, marginBottom: 4 }}>
      <Micro green>{en}</Micro>
      <T bold size={20} color={hud.ink} accessibilityRole="header" style={{ lineHeight: 28 }}>{title}</T>
      {note ? <T size={12.5} color={hud.muted} style={{ lineHeight: 19 }}>{note}</T> : null}
    </View>
  );
}

/** ステップの進み（4 本の棒。済んだ・今はミント） */
export function StepBars({ step, total }: { step: number; total: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessible accessibilityLabel={`${total}ステップのうち${step}`}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 3, backgroundColor: i < step ? hud.green : hud.barTrack }} />
      ))}
    </View>
  );
}

const ANDROID_LABEL = Platform.OS === 'android' ? { lineHeight: undefined } : null;

/**
 * ボタン：filled（ミントの塗り）・outline（枠だけ）・danger（赤の文字の枠）。角の切り欠き。押せる高さは 48 以上。
 * 文字は 1 行に収め、入らなければ小さくする（Android で最後の字が切れないように、ui.tsx の Button と同じ形）
 */
export function HudButton({ label, onPress, variant = 'filled', disabled, busy, testID, accessibilityLabel, style }: {
  label: string; onPress: () => void; variant?: 'filled' | 'outline' | 'danger'; disabled?: boolean; busy?: boolean; testID?: string;
  accessibilityLabel?: string; style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || busy;
  const filled = variant === 'filled';
  const fg = filled ? hud.onGreen : variant === 'danger' ? colors.danger : hud.green;
  return (
    <PressableScale
      accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: !!off, busy: !!busy }} aria-busy={!!busy}
      onPress={onPress} disabled={off} testID={testID} scaleTo={0.98} style={[{ minHeight: 48 }, style]}
    >
      <NotchChip fill={filled ? hud.green : undefined} border={filled ? undefined : variant === 'danger' ? colors.danger : hud.line} cut={8}
        style={{ minHeight: 48, paddingHorizontal: 16, opacity: off ? 0.4 : 1 }}>
        <T bold size={14} color={fg} numberOfLines={1} adjustsFontSizeToFit textBreakStrategy="simple" style={[{ flexShrink: 1 }, ANDROID_LABEL]}>{label}</T>
      </NotchChip>
    </PressableScale>
  );
}

/** 文字だけのボタン（「あとで」「スキップ」）。押せる範囲は 48 */
export function TextButton({ label, onPress, testID, color = hud.green }: { label: string; onPress: () => void; testID?: string; color?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} hitSlop={4}
      style={{ minHeight: 48, minWidth: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }}>
      <T bold size={13} color={color}>{label}</T>
    </Pressable>
  );
}

/** 選択肢のカード（向き）。選んだものはミントの枠と印 */
export function ChoiceCard({ title, en, body, selected, onPress, testID }: {
  title: string; en: string; body: string; selected: boolean; onPress: () => void; testID?: string;
}) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected} accessibilityLabel={`${title}。${body}`}
      onPress={onPress} testID={testID}>
      <Panel border={selected ? hud.green : hud.line} bg={selected ? '#0F1C15' : hud.panel} style={{ paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Micro green={selected}>{en}</Micro>
          <T bold size={15} color={selected ? hud.green : hud.ink}>{title}</T>
          <T size={12} color={hud.muted} style={{ lineHeight: 18 }}>{body}</T>
        </View>
        <View style={{ width: 18, height: 18, borderWidth: 1, borderColor: selected ? hud.green : hud.muted, alignItems: 'center', justifyContent: 'center' }}>
          {selected && <View style={{ width: 10, height: 10, backgroundColor: hud.green }} />}
        </View>
      </Panel>
    </Pressable>
  );
}

/** 小さな選択肢（期間の週など）。選んだものはミントの塗り */
export function HudChip({ label, selected, onPress, accessibilityLabel }: { label: string; selected: boolean; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected} accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress} style={{ minHeight: 48, justifyContent: 'center' }}>
      <NotchChip fill={selected ? hud.green : undefined} border={selected ? undefined : hud.line} cut={6} style={{ minHeight: 34, minWidth: 56, paddingHorizontal: 12 }}>
        <Mono size={13} color={selected ? hud.onGreen : hud.ink}>{label}</Mono>
      </NotchChip>
    </Pressable>
  );
}

/** 数の入力欄：上に小さなラベル、右に単位。等幅の字 */
export function NumberField({ label, value, onChange, unit, placeholder, testID, keyboardType = 'decimal-pad', maxLength = 7 }: {
  label: string; value: string; onChange: (t: string) => void; unit?: string; placeholder?: string; testID?: string;
  keyboardType?: 'decimal-pad' | 'number-pad' | 'default'; maxLength?: number;
}) {
  const family = useMono();
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <T size={11.5} color={hud.muted}>{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: hud.line, backgroundColor: hud.panel2, paddingHorizontal: 12, minHeight: 48 }}>
        <Input
          value={value} onChangeText={onChange} keyboardType={keyboardType} placeholder={placeholder} accessibilityLabel={label} testID={testID}
          maxLength={maxLength} style={{ flex: 1, height: 46, color: hud.white, fontFamily: family, fontSize: 18 }}
        />
        {unit ? <Mono size={11} color={hud.muted}>{unit.toUpperCase()}</Mono> : null}
      </View>
    </View>
  );
}

/** 文字の入力欄（名前） */
export function TextField({ label, value, onChange, placeholder, testID, maxLength }: {
  label: string; value: string; onChange: (t: string) => void; placeholder?: string; testID?: string; maxLength?: number;
}) {
  return (
    <View style={{ gap: 4 }}>
      <T size={11.5} color={hud.muted}>{label}</T>
      <View style={{ borderWidth: 1, borderColor: hud.line, backgroundColor: hud.panel2, paddingHorizontal: 12, minHeight: 48, justifyContent: 'center' }}>
        <Input value={value} onChangeText={onChange} placeholder={placeholder} accessibilityLabel={label} testID={testID} maxLength={maxLength}
          style={{ height: 46, color: hud.ink, fontSize: 15 }} />
      </View>
    </View>
  );
}

/** 2 段の行（左に題と補足、右に値か矢印）。onPress があれば押せる。danger で赤い題 */
export function ActionRow({ title, sub, right, onPress, danger, last, testID, accessibilityLabel }: {
  title: string; sub?: string; right?: string; onPress?: () => void; danger?: boolean; last?: boolean; testID?: string; accessibilityLabel?: string;
}) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 9, borderBottomWidth: last ? 0 : 1, borderBottomColor: hud.rowLine }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T bold size={13.5} color={danger ? colors.danger : hud.ink}>{title}</T>
        {sub ? <T size={11.5} color={hud.muted} style={{ lineHeight: 17 }}>{sub}</T> : null}
      </View>
      {right ? <Mono size={12} color={hud.muted}>{right}</Mono> : null}
      {onPress ? <Mono size={14} color={hud.faint}>›</Mono> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? [title, sub, right].filter(Boolean).join('。')} onPress={onPress} testID={testID}>
      {body}
    </Pressable>
  );
}

/** 枠だけの小さな札（ペースの「順調」など） */
export function Tag({ children, testID }: { children: string; testID?: string }) {
  return (
    <View testID={testID} style={{ borderWidth: 1, borderColor: hud.green, paddingHorizontal: 8, paddingVertical: 2 }}>
      <T bold size={12} color={hud.green}>{children}</T>
    </View>
  );
}
