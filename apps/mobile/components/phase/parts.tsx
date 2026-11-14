// フェーズの設定（app/phase/new.tsx）と進捗の詳細（app/phase/index.tsx）の見た目の部品。
// 構成は Figma「スタディ：フェーズ」のセクション 2・3、見た目はレポート詳細（components/report/hud.tsx）の文法：
// 近黒の地とパネル、1px の枠、角の切り欠き、等幅の英字のラベル、色はミント 1 色とモノクロ（中断だけ赤）
import { ReactNode, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleProp, useWindowDimensions, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDays, addMonths, DateKey, formatJpDate, MONTH_NAMES_EN, WEEKDAY_EN, weekday, yearMonth } from '@/lib/date';
import { PHASE_LIMITS, PHASE_TICKS, PhaseTicks, tickState } from '@/lib/phases';
import { colors } from '@/theme';
import { Input } from '../Input';
import { MonthCalendar } from '../MonthCalendar';
import { PressableScale, Sheet } from '../motion';
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

/** シートの中身（hud の色で）。題・中身・断られたときの理由 */
export function SheetBody({ title, error, children }: { title: string; error: string | null; children: ReactNode }) {
  return (
    <HudFonts>
      <View style={{ backgroundColor: hud.panel, padding: 16, gap: 12, borderTopWidth: 1, borderColor: hud.line }}>
        <T bold size={16} color={hud.ink} accessibilityRole="header">{title}</T>
        {children}
        {error && <T size={13} color={colors.danger} accessibilityRole="alert">{error}</T>}
      </View>
    </HudFonts>
  );
}

/** 左に緑の小さな見出し、右に文（確かめのシートの「止まる」「出さない」など） */
export function NoteRow({ label, children }: { label: string; children: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <T bold size={12.5} color={hud.green} style={{ width: 64 }}>{label}</T>
      <T size={13} color={hud.ink} style={{ flex: 1, lineHeight: 20 }}>{children}</T>
    </View>
  );
}

/**
 * 療養に入るときの確かめ（Figma「スタディ：フェーズ」の療養 2）。進捗の詳細の「療養に入る」と、ケガの詳細の「このケガで療養に入る」が使う。
 * 止まるもの（フェーズと終わりの日）・出さないもの（ペースの判定）・見るものを出し、名前（なくてもよい）を入れて始める。食事や治療の助言は書かない
 */
export function RehabStartSheet({ visible, onClose, title, paused, defaultName = '', busy, error, onStart }: {
  visible: boolean; onClose: () => void; title: string;
  /** 止めるフェーズ（なければ null）：名前と今の週 */
  paused: { label: string; week: number } | null;
  defaultName?: string; busy: boolean; error: string | null; onStart: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  useEffect(() => { if (visible) setName(defaultName); }, [visible, defaultName]);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetBody title={title} error={error}>
        <View style={{ gap: 10 }} testID="rehab-start-notes">
          <NoteRow label="止まる">
            {paused
              ? `${paused.label}（${paused.week}週目）。時計を止め、療養の日数だけ終わりの日を後ろにずらします。`
              : '実施中のフェーズはないので、止めるものはありません。療養の日数を数えます。'}
          </NoteRow>
          <NoteRow label="出さない">療養中と、戻ってから2週間は、体重のペースを判定しません。ホームの輪の週も進めません。</NoteRow>
          <NoteRow label="見るもの">睡眠・食事・ケガの振り返り</NoteRow>
        </View>
        <T size={11.5} color={hud.muted} style={{ lineHeight: 17 }}>
          終えるのは自分で決めます。直している途中のケガがすべて「直せた」になったら、終えるかを聞きます。
        </T>
        <TextField label="名前（なくてもよい。例：風邪）" value={name} onChange={setName} maxLength={PHASE_LIMITS.name} testID="phase-rehab-name" />
        <HudButton label="療養に入る" busy={busy} onPress={() => onStart(name)} testID="phase-rehab-save" />
        <TextButton label="やめる" onPress={onClose} />
      </SheetBody>
    </Sheet>
  );
}

/**
 * 進み具合の目盛り（16 個で決まった数。期間に比例して進む：8 週なら 1 週で 2 つ。lib/phases.ts の phaseTicks）。
 * 過ぎた目盛りはミント、今の目盛りは明るいミントの枠、これからは灰色。止まっているあいだ（療養）は過ぎた目盛りも灰色。ホームの輪と同じ数え方
 */
export function TickBar({ ticks, paused = false, accessibilityLabel, testID }: {
  ticks: PhaseTicks | null; paused?: boolean; accessibilityLabel: string; testID?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }} accessible accessibilityLabel={accessibilityLabel} testID={testID}>
      {Array.from({ length: PHASE_TICKS }, (_, i) => {
        const k = tickState(ticks, i);
        const bg = k === 'todo' ? hud.barTrack : paused ? hud.faint : k === 'done' ? hud.green : hud.panel2;
        return (
          <View key={i} testID={testID ? `${testID}-${k}` : undefined}
            style={{ flex: 1, height: 10, backgroundColor: bg, borderWidth: k === 'current' ? 1 : 0, borderColor: paused ? hud.muted : hud.green }} />
        );
      })}
    </View>
  );
}

/** 2 つの切り替え（編集のシートの「今日から計画を変える」「開始日・最初の計画を直す」）。選んだものはミントの枠と塗り */
export function ModeTabs<K extends string>({ options, value, onChange }: {
  options: { key: K; title: string; sub: string }[]; value: K; onChange: (k: K) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 6 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={`${o.title}。${o.sub}`}
            onPress={() => onChange(o.key)} style={{ flex: 1 }} testID={`phase-mode-${o.key}`}>
            <Panel border={on ? hud.green : hud.line} bg={on ? '#0F1C15' : hud.panel2} cut={6} style={{ paddingHorizontal: 10, paddingVertical: 8, gap: 2, minHeight: 64 }}>
              <T bold size={13} color={on ? hud.green : hud.ink}>{o.title}</T>
              <T size={11} color={hud.muted} style={{ lineHeight: 15 }}>{o.sub}</T>
            </Panel>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 四角い小さなボタン（−・＋・‹・›）。押せる大きさは 48 */
function SquareButton({ label, text, onPress, disabled, testID }: { label: string; text: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
      onPress={onPress} testID={testID} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
      <View style={{ width: 40, height: 40, borderWidth: 1, borderColor: hud.line, backgroundColor: hud.panel2, alignItems: 'center', justifyContent: 'center' }}>
        <Mono size={16} color={hud.green}>{text}</Mono>
      </View>
    </Pressable>
  );
}

/** 期間（週）：− と ＋ で 1 週ずつ。まん中は直接入れられる。min〜max の外は押せない */
export function WeeksStepper({ value, onChange, min, max, testID }: {
  value: string; onChange: (text: string) => void; min: number; max: number; testID?: string;
}) {
  const n = Number(value);
  const ok = value.trim() !== '' && Number.isInteger(n);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
      <SquareButton label="期間を1週短くする" text="−" disabled={!ok || n <= min} onPress={() => onChange(String(Math.max(min, n - 1)))} testID={testID ? `${testID}-minus` : undefined} />
      <NumberField label={`期間（${min}〜${max}週）`} unit="週" value={value} onChange={onChange} keyboardType="number-pad" maxLength={3} testID={testID} />
      <SquareButton label="期間を1週長くする" text="＋" disabled={!ok || n >= max} onPress={() => onChange(String(Math.min(max, n + 1)))} testID={testID ? `${testID}-plus` : undefined} />
    </View>
  );
}

/**
 * 日付の欄（フェーズの開始日）：‹ › で 1 日ずつ、「カレンダー」で月のカレンダーを開いて選ぶ。min〜max の外は選べない（max は今日）
 */
export function DateField({ label, value, onChange, min, max, testID }: {
  label: string; value: DateKey; onChange: (d: DateKey) => void; min: DateKey | null; max: DateKey; testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value.slice(0, 7) + '-01');
  useEffect(() => { if (open) setMonth(value.slice(0, 7) + '-01'); }, [open, value]);
  const prev = addDays(value, -1);
  const next = addDays(value, 1);
  const { year, month: m } = yearMonth(month);
  const lastMonth = max.slice(0, 7) + '-01';
  const firstMonth = min ? min.slice(0, 7) + '-01' : null;
  return (
    <View style={{ gap: 4 }}>
      <T size={11.5} color={hud.muted}>{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <SquareButton label="1日前にする" text="‹" disabled={min != null && prev < min} onPress={() => onChange(prev)} testID={testID ? `${testID}-prev` : undefined} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}：${formatJpDate(value)}${value === max ? '（今日）' : ''}。カレンダーで選ぶ`}
          accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} testID={testID}
          style={{ flex: 1, minHeight: 48, borderWidth: 1, borderColor: open ? hud.green : hud.line, backgroundColor: hud.panel2, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Mono size={18} color={hud.white}>{value.slice(5).replace('-', '/')}</Mono>
          <Mono size={11} color={hud.muted}>{WEEKDAY_EN[weekday(value)]}</Mono>
          <View style={{ flex: 1 }} />
          <Mono size={10} color={value === max ? hud.green : hud.muted}>{value === max ? 'TODAY' : 'CAL'}</Mono>
        </Pressable>
        <SquareButton label="1日後にする" text="›" disabled={next > max} onPress={() => onChange(next)} testID={testID ? `${testID}-next` : undefined} />
      </View>
      {open && (
        <View style={{ borderWidth: 1, borderColor: hud.line2, padding: 8, gap: 6 }} testID={testID ? `${testID}-calendar` : undefined}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <SquareButton label="前の月" text="‹" disabled={firstMonth != null && month <= firstMonth} onPress={() => setMonth(addMonths(month, -1))} />
            <Mono size={13} color={hud.ink}>{`${MONTH_NAMES_EN[m - 1]} ${year}`}</Mono>
            <SquareButton label="次の月" text="›" disabled={month >= lastMonth} onPress={() => setMonth(addMonths(month, 1))} />
          </View>
          <MonthCalendar year={year} month={m} today={max} marked={new Set()} selected={value} maxDate={max} minDate={min} cell={40}
            onPressDay={(d) => { onChange(d); setOpen(false); }} />
        </View>
      )}
    </View>
  );
}
