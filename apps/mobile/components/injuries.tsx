// ケガの記録の部品（Figma「スタディ：ケガの記録」の強め版）。一覧の体の図（BODY MAP // SCAN）、走査の枠、状態の札、一覧の行
import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Line, Path, Pattern, Rect } from 'react-native-svg';
import type { Injury } from '@/db/repositories/injuries';
import { useFocusData } from '@/hooks/data';
import { addDays, formatJpDate, formatShortDate, todayKey } from '@/lib/date';
import { dotDate, injuryNumbers, InjuryStatus, RESULT_KEYS, ReviewResult, RESULTS, siteLabel, STATUS_NAMES } from '@/lib/injuries';
import { INJURY_LIMITS } from '@/lib/limits';
import { markPoint, MuscleView } from '@/lib/muscleFigure';
import { colors, fonts, radius, space, toneColors } from '@/theme';
import { AI_RECORD_LABEL, useChatChooser } from './ChatSheet';
import { DayPickerSheet } from './DayPicker';
import { Icon } from './Icon';
import { InjuryBodyMap3D } from './InjuryBodyMap3D';
import { Input } from './Input';
import { LoadError } from './LoadError';
import { PressableScale, Sheet } from './motion';
import { INJURY_AMBER, MuscleFigure } from './MuscleFigure';
import { T } from './Text';
import { Button, Chip, EmptyState, ListRow, Segmented } from './ui';

/** 走査の枠の線（控えめな緑） */
const SCAN_LINE = colors.accentMuted;
/** 方眼の線 */
const GRID = '#1C2A23';

/** 英字の小さな見出し（「BODY MAP // SCAN」）。数字の字体で字間を空ける。11sp 以上 */
export function Mono({ children, color = colors.sub, size = 12 }: { children: ReactNode; color?: string; size?: number }) {
  return <T style={{ fontFamily: fonts.num, fontSize: size, letterSpacing: 1.5, color }}>{children}</T>;
}

/**
 * 走査の枠：角の括弧と方眼の地。strong は緑の枠（一覧の体の図）。中身は children
 */
export function ScanFrame({ children, strong, style, testID }: { children: ReactNode; strong?: boolean; style?: object; testID?: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <View
      testID={testID}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={[s.frame, { borderColor: strong ? SCAN_LINE : colors.line }, style]}
    >
      {size && (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill} pointerEvents="none">
          {strong && (
            <>
              <Defs>
                <Pattern id="scan-grid" width={24} height={24} patternUnits="userSpaceOnUse">
                  <Path d="M24 0H0V24" fill="none" stroke={GRID} strokeWidth={1} />
                </Pattern>
              </Defs>
              <Rect x={0} y={0} width={size.w} height={size.h} fill="url(#scan-grid)" />
            </>
          )}
          {/* 角の括弧 */}
          {[[10, 10, 1, 1], [size.w - 10, 10, -1, 1], [10, size.h - 10, 1, -1], [size.w - 10, size.h - 10, -1, -1]].map(([x, y, dx, dy]) => (
            <Path key={`${x}-${y}`} d={`M${x} ${y + 14 * dy}V${y}H${x + 14 * dx}`} fill="none" stroke={strong ? colors.accent : colors.sub} strokeWidth={1.5} />
          ))}
        </Svg>
      )}
      {children}
    </View>
  );
}

/** 状態の札。直している途中は琥珀色の点、直せたは緑の中抜きの丸（色だけにしない：文字と形） */
export function StatusBadge({ status }: { status: InjuryStatus }) {
  const fixing = status === 'fixing';
  return (
    <View style={[s.badge, { backgroundColor: fixing ? toneColors.caution.container : colors.accentDark }]}>
      <View style={[s.dot, fixing ? { backgroundColor: INJURY_AMBER } : { borderWidth: 1.5, borderColor: colors.onAccentDark }]} />
      <T variant="labelM" color={fixing ? INJURY_AMBER : colors.onAccentDark}>{STATUS_NAMES[status]}</T>
    </View>
  );
}

/** 「ベンチプレス・ラックアップ」（種目と場面。ないものは省く） */
export const whereText = (i: Pick<Injury, 'exerciseName' | 'phase'>) => [i.exerciseName, i.phase].filter(Boolean).join('・');

/** 図に札を出す数（左右それぞれ）。直している途中を先に、痛めた日の新しい順 */
const CALLOUTS_PER_SIDE = 2;
/** 図の幅の上限（高さはこの 2 倍。Figma「ケガ 1-2」：412・360 の幅とも 128×256。前は 82×164 で、札に場所を取られて小さかった） */
const FIG_W_MAX = 128;
const FIG_GAP = 8;
/** 札の高さ（INJ の番号と部位の 2 行。上下 6 の余白） */
const CALLOUT_H = 48;
/** 図の下の「R FRONT L」の行 */
const FIG_LABEL_H = 20;

type Placed = { injury: Injury; view: MuscleView; x: number; y: number };

/**
 * 一覧の上の体の図（BODY MAP // SCAN）。前と後ろの図に、ケガの印（直している途中は琥珀色で脈打つ、直せたは緑の輪）。
 * 図を大きくするため（Figma「ケガ 1-2」）、札は INJ の番号と部位だけにして、半透明の地で図に重ねる（日付・種目・状態は下のカードと行）。
 * 前の図のものを左の端、後ろの図のものを右の端に、それぞれ2つまで、印の少し上に出す
 * （200件まで持てるので全部は出さない。直している途中を先に、痛めた日の新しい順）。読み上げでは件数だけを読む
 */
export function InjuryBodyMap({ injuries, numbers }: { injuries: Injury[]; numbers: Map<string, string> }) {
  const [width, setWidth] = useState(0);
  const active = injuries.filter((i) => i.status === 'fixing').length;
  const cleared = injuries.length - active;
  const marks = injuries.map((i) => ({ key: i.id, site: i.site, side: i.side, status: i.status }));
  // 図の大きさと置き場所：幅いっぱいに近い大きさで、まん中に前と後ろ
  const figW = Math.max(0, Math.min(FIG_W_MAX, Math.floor((width - FIG_GAP) / 2)));
  const figH = figW * 2;
  const left = Math.max(0, (width - (figW * 2 + FIG_GAP)) / 2);
  const backLeft = left + figW + FIG_GAP;
  const placed: Placed[] = injuries.flatMap((injury) => {
    const at = markPoint(injury.site, injury.side);
    if (!at) return [];
    const x0 = at.view === 'front' ? left : backLeft;
    return [{ injury, view: at.view, x: x0 + at.point.x * (figW / 100), y: at.point.y * (figH / 200) }];
  });
  const pick = (view: MuscleView) => placed
    .filter((p) => p.view === view)
    .sort((a, b) => Number(a.injury.status === 'fixed') - Number(b.injury.status === 'fixed') || (a.injury.occurredOn < b.injury.occurredOn ? 1 : -1))
    .slice(0, CALLOUTS_PER_SIDE)
    .sort((a, b) => a.y - b.y);
  // 札の高さの位置：印の少し上（印を隠さない）。図の中に収め、重ならないように、上から順に下へ、下から順に上へずらす
  const stack = (ps: Placed[]) => {
    const tops: number[] = [];
    let next = 0;
    for (const p of ps) {
      const top = Math.max(next, p.y - CALLOUT_H - space.s);
      tops.push(top);
      next = top + CALLOUT_H + space.xs;
    }
    let limit = figH - CALLOUT_H;
    for (let i = tops.length - 1; i >= 0; i--) {
      tops[i] = Math.max(0, Math.min(tops[i], limit));
      limit = tops[i] - CALLOUT_H - space.xs;
    }
    return ps.map((p, i) => ({ ...p, top: tops[i] }));
  };
  const leftOnes = stack(pick('front'));
  const rightOnes = stack(pick('back'));
  // 札の幅は左右それぞれ半分まで（いちばん長い「右のふくらはぎ」でも 360 の幅で切れない）
  const calloutMax = width / 2 - FIG_GAP;
  // 引き出し線は札の外側寄りの下（印より下に札があるときは上）から印へ
  const lineFrom = (p: Placed & { top: number }, x: number) => ({ x, y: p.top + CALLOUT_H <= p.y ? p.top + CALLOUT_H : p.top });

  return (
    <ScanFrame strong style={{ paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: space.m }} testID="injury-map">
      <View accessible accessibilityLabel={`体の図。直している途中 ${active}件、直せた ${cleared}件`} style={{ gap: space.s }}>
        <View style={[s.mapHead, { alignItems: 'flex-start' }]}>
          <Mono color={colors.accent}>BODY MAP // SCAN</Mono>
          {/* ALERT は件数の下（図の下の行に置くと、360 の幅で「L BACK R」と重なる） */}
          <View style={{ alignItems: 'flex-end' }}>
            <Mono>{`ACTIVE ${String(active).padStart(2, '0')} / CLEARED ${String(cleared).padStart(2, '0')}`}</Mono>
            {active > 0 && <Mono color={INJURY_AMBER}>{`▲ ${active} ALERT`}</Mono>}
          </View>
        </View>
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: figH + FIG_LABEL_H }}>
          {width > 0 && (
            <>
              <View style={{ position: 'absolute', left, top: 0, flexDirection: 'row', gap: FIG_GAP }} testID="injury-map-figures">
                <MuscleFigure view="front" width={figW} height={figH} marks={marks} />
                <MuscleFigure view="back" width={figW} height={figH} marks={marks} />
              </View>
              <View style={[s.figLabel, { left, width: figW, top: figH }]}><Mono>R FRONT L</Mono></View>
              <View style={[s.figLabel, { left: backLeft, width: figW, top: figH }]}><Mono>L BACK R</Mono></View>
              {/* 札と印をつなぐ線 */}
              <Svg width={width} height={figH} style={StyleSheet.absoluteFill} pointerEvents="none">
                {[...leftOnes.map((p) => ({ p, from: lineFrom(p, space.l) })), ...rightOnes.map((p) => ({ p, from: lineFrom(p, width - space.l) }))].map(({ p, from }) => (
                  <Line key={p.injury.id} x1={from.x} y1={from.y} x2={p.x} y2={p.y}
                    stroke={p.injury.status === 'fixing' ? INJURY_AMBER : colors.sub} strokeWidth={1} strokeOpacity={0.7} />
                ))}
              </Svg>
              {leftOnes.map((p) => (
                <Callout key={p.injury.id} injury={p.injury} number={numbers.get(p.injury.id) ?? ''} style={{ left: 0, top: p.top, maxWidth: calloutMax, alignItems: 'flex-start' }} />
              ))}
              {rightOnes.map((p) => (
                <Callout key={p.injury.id} injury={p.injury} number={numbers.get(p.injury.id) ?? ''} style={{ right: 0, top: p.top, maxWidth: calloutMax, alignItems: 'flex-end' }} />
              ))}
            </>
          )}
        </View>
      </View>
    </ScanFrame>
  );
}

/** 図に重ねる札：INJ の番号と部位だけ。半透明の地で、下の図が透ける。直している途中は琥珀色の枠と ▲（色だけにしない） */
function Callout({ injury, number, style }: { injury: Injury; number: string; style: object }) {
  const fixing = injury.status === 'fixing';
  const tone = fixing ? INJURY_AMBER : colors.sub;
  return (
    <View style={[s.callout, { borderColor: tone }, style]} testID="injury-callout">
      <Mono color={tone} size={11}>{`${number}${fixing ? ' ▲' : ''}`}</Mono>
      <T variant="labelL" numberOfLines={1}>{siteLabel(injury.site, injury.side)}</T>
    </View>
  );
}

/**
 * 3D の体の図の横に出す吹き出し（INJ の番号・部位と日付・種目と場面・状態）。引き出し線で部位とつなぐ。
 * align は文字を寄せる側（図の左の吹き出しは右寄せ）
 */
export function SideCallout({ injury, number, align, style }: { injury: Injury; number: string; align: 'left' | 'right'; style: object }) {
  const fixing = injury.status === 'fixing';
  const tone = fixing ? INJURY_AMBER : colors.sub;
  return (
    <View style={[{ position: 'absolute', alignItems: align === 'right' ? 'flex-end' : 'flex-start' }, style]}>
      <Mono color={tone} size={11}>{`${number}${fixing ? ' ▲' : ''}`}</Mono>
      <T variant="labelL" numberOfLines={1}>{siteLabel(injury.site, injury.side)} <T num size={13} color={colors.sub}>{dotDate(injury.occurredOn)}</T></T>
      {whereText(injury) !== '' && <T size={11} color={colors.sub} numberOfLines={1} align={align}>{whereText(injury)}</T>}
      {/* 図の横は狭い（360 の幅で 90 ほど）ので、状態は短く 1 行。札と読み上げは正式な名前 */}
      <T variant="labelS" color={fixing ? INJURY_AMBER : colors.accent} numberOfLines={1} align={align}>{fixing ? '● 直し中' : '○ 直せた'}</T>
    </View>
  );
}

/** 直している途中のケガのカード（左に琥珀色の帯）。次の直し方（NEXT）と振り返りの回数・最後の結果 */
export function ActiveInjuryCard({ injury }: { injury: Injury }) {
  const label = siteLabel(injury.site, injury.side);
  const last = injury.lastReview;
  const sub = [whereText(injury), injury.symptom].filter(Boolean).join('／');
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}、直している途中、${formatShortDate(injury.occurredOn)}`}
      onPress={() => router.push(`/injuries/${injury.id}`)}
      scaleTo={0.98}
      style={s.activeCard}
      testID={`injury-${injury.id}`}
    >
      <View style={{ flex: 1, gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <T variant="titleM">{label}</T>
          <StatusBadge status="fixing" />
          <View style={{ flex: 1 }} />
          <T num size={15} color={colors.sub}>{dotDate(injury.occurredOn)}</T>
        </View>
        {sub !== '' && <T variant="bodyM" color={colors.text} numberOfLines={2}>{sub}</T>}
        {injury.fix !== '' && (
          <T variant="bodyM" numberOfLines={2}><T style={{ fontFamily: fonts.num, letterSpacing: 1 }} color={colors.accent}>NEXT </T>{injury.fix}</T>
        )}
        <T variant="bodyS" color={colors.sub}>
          {`振り返り ${injury.reviewCount}回${last ? ` ・ 最後 ${formatShortDate(last.date)} ${RESULTS[last.result].label}` : ''}`}
        </T>
      </View>
      <Icon name="chevron" color={colors.sub} size={24} />
    </PressableScale>
  );
}

/** 直せたケガの行 */
export function FixedInjuryRow({ injury, first }: { injury: Injury; first: boolean }) {
  const label = siteLabel(injury.site, injury.side);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}、直せた、${formatShortDate(injury.occurredOn)}`}
      onPress={() => router.push(`/injuries/${injury.id}`)}
      scaleTo={0.98}
      style={[s.fixedRow, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]}
      testID={`injury-${injury.id}`}
    >
      <View style={s.fixedRing} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
          <T variant="titleM">{label}</T>
          <T variant="labelM" color={colors.sub}>直せた</T>
        </View>
        {whereText(injury) !== '' && <T variant="bodyM" color={colors.sub} numberOfLines={1}>{whereText(injury)}</T>}
      </View>
      <T num size={15} color={colors.sub}>{dotDate(injury.occurredOn)}</T>
      <Icon name="chevron" color={colors.sub} size={24} />
    </PressableScale>
  );
}

/** 一覧の区分けの見出し（「直している途中 ACTIVE · 1」） */
export function InjurySectionTitle({ title, en, count }: { title: string; en: string; count: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s, marginTop: space.xl, marginBottom: space.s }}>
      <T variant="titleS" color={colors.sub} accessibilityRole="header">{title}</T>
      <Mono>{`${en} · ${count}`}</Mono>
    </View>
  );
}

export type ReviewDraft = { date: string; result: ReviewResult; note: string; withExercise: boolean };

/**
 * 振り返りを足すシート（ケガの1件の画面と、筋トレの入力画面の「直すこと」の帯で使う）。試した日・結果・種目で試したか・メモ。
 * locked を渡すと、試した日と種目は決め打ちにして（帯から開くとき：その画面の日付と種目）、選ぶ行の代わりに文字で出す。
 * onAi を渡すと、「足す」の下に「AI で書く」（振り返りをチャットに任せる。呼ぶ側でこのシートを閉じて、アプリを選ぶシートを出す）
 */
export function ReviewSheet({ draft, onChange, today, exerciseName, locked, error, busy, onClose, onSave, onAi }: {
  draft: ReviewDraft | null; onChange: (d: ReviewDraft) => void; today: string; exerciseName: string | null;
  locked?: boolean; error: string | null; busy: boolean; onClose: () => void; onSave: () => void; onAi?: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <>
      <Sheet visible={draft != null && !picking} onClose={onClose}>
        {draft && (
          // 入力欄がキーボードに隠れないように（components/BodyInputSheet.tsx と同じ）
          <KeyboardAvoidingView behavior="padding">
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.xl + insets.bottom, gap: space.m }}>
            <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: colors.sub }} />
            <T variant="headlineS" accessibilityRole="header">振り返りを足す</T>
            {locked ? (
              <T variant="bodyM" color={colors.sub}>{[formatJpDate(draft.date), exerciseName && draft.withExercise ? `${exerciseName}で試した` : ''].filter(Boolean).join(' ・ ')}</T>
            ) : (
              <View style={{ gap: space.xs }}>
                <T variant="titleS" color={colors.sub}>試した日</T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.s }}>
                  <Chip label="今日" active={draft.date === today} onPress={() => onChange({ ...draft, date: today })} />
                  <Chip label="昨日" active={draft.date === addDays(today, -1)} onPress={() => onChange({ ...draft, date: addDays(today, -1) })} />
                  <Chip
                    label={draft.date < addDays(today, -1) ? formatJpDate(draft.date) : 'ほかの日'}
                    active={draft.date < addDays(today, -1)}
                    accessibilityLabel={`ほかの日を選ぶ${draft.date < addDays(today, -1) ? `、${formatJpDate(draft.date)}` : ''}`}
                    onPress={() => setPicking(true)}
                  />
                </View>
              </View>
            )}
            <View style={{ gap: space.xs }}>
              <T variant="titleS" color={colors.sub}>結果</T>
              <Segmented<ReviewResult>
                options={RESULT_KEYS.map((k) => ({ key: k, label: `${RESULTS[k].mark} ${RESULTS[k].label}` }))}
                value={draft.result}
                onChange={(result) => onChange({ ...draft, result })}
              />
            </View>
            {!locked && exerciseName && (
              <Chip label={`${exerciseName}で試した`} active={draft.withExercise} onPress={() => onChange({ ...draft, withExercise: !draft.withExercise })} />
            )}
            <Input
              value={draft.note}
              onChangeText={(note) => onChange({ ...draft, note })}
              accessibilityLabel="メモ"
              placeholder="例：寄せてから外せた"
              placeholderTextColor={colors.sub}
              maxLength={INJURY_LIMITS.reviewNote * 2}
              multiline
              style={s.input}
            />
            {error && <T variant="bodyM" color={colors.danger} accessibilityLiveRegion="polite">{error}</T>}
            <Button label={busy ? '保存しています…' : '足す'} icon="check" onPress={onSave} busy={busy} testID="review-save" />
            {onAi && (
              <Button label="AI で書く" icon="chat" variant="text" accessibilityLabel={`${AI_RECORD_LABEL}（振り返り）`} onPress={onAi} testID="review-ai-record" />
            )}
          </ScrollView>
          </KeyboardAvoidingView>
        )}
      </Sheet>
      {draft && !locked && (
        <DayPickerSheet visible={picking} kind="training" value={draft.date} today={today} onClose={() => setPicking(false)}
          onPick={(date) => onChange({ ...draft, date })} />
      )}
    </>
  );
}

/**
 * 筋トレのタブの「ケガ」の中身：体の図、直している途中（カード）、直せた（行）。記録がなければ責めない一言。
 * 右下の「ケガを記録」は画面の側（タブの画面の FAB。押すと useInjuryAddSheet のシート）
 */
export function InjuryListContent() {
  const { data, error, reload } = useFocusData((r) => r.injuries.list());
  if (error) return <LoadError onRetry={reload} />;
  if (data == null) return null;
  if (data.length === 0) {
    return (
      <EmptyState
        icon="alert"
        title="ケガの記録はありません"
        body="痛めたときに、どの場面で何が起きたかと、次の直し方を残せます。直し方を試した結果も足していけます。"
      />
    );
  }
  const numbers = injuryNumbers(data);
  const active = data.filter((i) => i.status === 'fixing');
  const fixed = data.filter((i) => i.status === 'fixed');
  return (
    <View style={{ marginTop: space.l }}>
      {/* Android は 3D の体（描けないときは 2D）。web（e2e）は 2D */}
      {InjuryBodyMap3D ? <InjuryBodyMap3D injuries={data} numbers={numbers} /> : <InjuryBodyMap injuries={data} numbers={numbers} />}
      {active.length > 0 && (
        <>
          <InjurySectionTitle title="直している途中" en="ACTIVE" count={active.length} />
          <View style={{ gap: space.s }}>{active.map((i) => <ActiveInjuryCard key={i.id} injury={i} />)}</View>
        </>
      )}
      {fixed.length > 0 && (
        <>
          <InjurySectionTitle title="直せた" en="CLEARED" count={fixed.length} />
          <View style={s.fixedList}>{fixed.map((i, n) => <FixedInjuryRow key={i.id} injury={i} first={n === 0} />)}</View>
        </>
      )}
    </View>
  );
}

/**
 * 「ケガを記録」（一覧の右下の FAB）で出す、記録の方法を選ぶシート：AI で記録（チャットで聞き取って record_injury）か、自分で入力（記録する画面）。
 * 食事の記録の方法のシートと同じ流れで、AI を選んだらこのシートを閉じて、チャットのアプリを選ぶシートを出す
 */
export function useInjuryAddSheet() {
  const [visible, setVisible] = useState(false);
  const chat = useChatChooser();
  const close = () => setVisible(false);
  const sheet = (
    <>
      <Sheet visible={visible} onClose={close}>
        <InjuryAddSheetBody
          onAi={() => { close(); chat.record({ kind: 'injury', today: todayKey() }); }}
          onManual={() => { close(); router.push('/injuries/new'); }}
        />
      </Sheet>
      {chat.sheet}
    </>
  );
  return { open: () => setVisible(true), sheet };
}

function InjuryAddSheetBody({ onAi, onManual }: { onAi: () => void; onManual: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ padding: space.l, paddingBottom: space.l + insets.bottom, gap: space.m }} testID="injury-add-sheet">
      <View>
        <T variant="titleL" accessibilityRole="header">ケガを記録</T>
        <T variant="bodyM" color={colors.sub}>記録の方法を選びます</T>
      </View>
      <View style={s.group}>
        <ListRow first icon="chat" chevron={false} title="AI で記録" subtitle="チャットで聞き取って記録します"
          right={<Icon name="external" color={colors.sub} size={24} />} label={`${AI_RECORD_LABEL}（ケガ）`} onPress={onAi} testID="injury-ai-record" />
        <ListRow icon="pencil" title="自分で入力" subtitle="図で部位を選んで書きます" onPress={onManual} testID="injury-new-manual" />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  group: { backgroundColor: colors.input, borderRadius: radius.card, overflow: 'hidden' },
  fixedList: { backgroundColor: colors.card, borderRadius: radius.l, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  frame: { borderWidth: 1, borderRadius: radius.l, backgroundColor: colors.card, overflow: 'hidden' },
  mapHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  figLabel: { position: 'absolute', height: FIG_LABEL_H, alignItems: 'center', justifyContent: 'flex-end' },
  // 半透明の地（85%）。図が少し透けて、文字は背景に対して十分な濃さ
  callout: {
    position: 'absolute', height: CALLOUT_H, justifyContent: 'center', paddingHorizontal: space.s, borderWidth: 1, borderRadius: radius.s,
    backgroundColor: `${colors.bg}D9`,
  },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radius.s, paddingHorizontal: space.s, paddingVertical: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  activeCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: colors.card, borderRadius: radius.l, borderWidth: 1,
    borderColor: toneColors.caution.container, borderLeftWidth: 4, borderLeftColor: INJURY_AMBER, padding: space.l, minHeight: 48,
  },
  fixedRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m, minHeight: 72 },
  fixedRing: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.accentMuted },
  input: {
    minHeight: 72, borderRadius: radius.m, borderWidth: 1, borderColor: colors.outline, backgroundColor: colors.input, color: colors.text,
    fontFamily: fonts.regular, fontSize: 16, paddingHorizontal: space.l, paddingVertical: space.m, textAlignVertical: 'top',
  },
});
