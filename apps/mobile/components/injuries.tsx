// ケガの記録の部品（Figma「スタディ：ケガの記録」の強め版）。一覧の体の図（BODY MAP // SCAN）、走査の枠、状態の札、一覧の行
import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Line, Path, Pattern, Rect } from 'react-native-svg';
import type { Injury } from '@/db/repositories/injuries';
import { useFocusData } from '@/hooks/data';
import { formatShortDate } from '@/lib/date';
import { dotDate, injuryNumbers, InjuryStatus, RESULTS, siteLabel, STATUS_NAMES } from '@/lib/injuries';
import { markPoint, MuscleView } from '@/lib/muscleFigure';
import { colors, fonts, radius, space, toneColors } from '@/theme';
import { Icon } from './Icon';
import { LoadError } from './LoadError';
import { PressableScale } from './motion';
import { INJURY_AMBER, MuscleFigure } from './MuscleFigure';
import { T } from './Text';
import { EmptyState } from './ui';

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

/** 図の横に吹き出しを出す数（左右それぞれ）。直している途中を先に、痛めた日の新しい順 */
const CALLOUTS_PER_SIDE = 2;
const FIG_H = 164;
const FIG_W = FIG_H / 2;
const FIG_GAP = 8;
const CALLOUT_H = 80;

type Placed = { injury: Injury; view: MuscleView; x: number; y: number };

/**
 * 一覧の上の体の図（BODY MAP // SCAN）。前と後ろの図に、ケガの印（直している途中は琥珀色で脈打つ、直せたは緑の輪）。
 * 吹き出し（INJ の番号・部位と日付・種目と場面・状態）は、前の図のものを左、後ろの図のものを右に、それぞれ2つまで出す
 * （200件まで持てるので全部は出さない。直している途中を先に、痛めた日の新しい順）。読み上げでは件数だけを読む
 */
export function InjuryBodyMap({ injuries, numbers }: { injuries: Injury[]; numbers: Map<string, string> }) {
  const [width, setWidth] = useState(0);
  const active = injuries.filter((i) => i.status === 'fixing').length;
  const cleared = injuries.length - active;
  const marks = injuries.map((i) => ({ key: i.id, site: i.site, side: i.side, status: i.status }));
  // 図の置き場所：まん中に前と後ろ。左右の余りに吹き出し
  const figsW = FIG_W * 2 + FIG_GAP;
  const left = Math.max(0, (width - figsW) / 2);
  const placed: Placed[] = injuries.flatMap((injury) => {
    const at = markPoint(injury.site, injury.side);
    if (!at) return [];
    const x0 = at.view === 'front' ? left : left + FIG_W + FIG_GAP;
    return [{ injury, view: at.view, x: x0 + at.point.x * (FIG_W / 100), y: at.point.y * (FIG_H / 200) }];
  });
  const pick = (view: MuscleView) => placed
    .filter((p) => p.view === view)
    .sort((a, b) => Number(a.injury.status === 'fixed') - Number(b.injury.status === 'fixed') || (a.injury.occurredOn < b.injury.occurredOn ? 1 : -1))
    .slice(0, CALLOUTS_PER_SIDE)
    .sort((a, b) => a.y - b.y);
  // 吹き出しの高さの位置：印の高さに合わせ、重ならないように下へずらす
  const stack = (ps: Placed[]) => {
    let next = 0;
    return ps.map((p) => {
      const top = Math.min(Math.max(next, p.y - 16), FIG_H - CALLOUT_H + 24);
      next = top + CALLOUT_H + 4;
      return { ...p, top };
    });
  };
  const leftOnes = stack(pick('front'));
  const rightOnes = stack(pick('back'));
  const calloutW = Math.max(0, left - space.s);

  return (
    <ScanFrame strong style={{ paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: space.m }} testID="injury-map">
      <View accessible accessibilityLabel={`体の図。直している途中 ${active}件、直せた ${cleared}件`} style={{ gap: space.s }}>
        <View style={s.mapHead}>
          <Mono color={colors.accent}>BODY MAP // SCAN</Mono>
          <Mono>{`ACTIVE ${String(active).padStart(2, '0')} / CLEARED ${String(cleared).padStart(2, '0')}`}</Mono>
        </View>
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: FIG_H + 8 }}>
          {width > 0 && (
            <>
              <View style={{ position: 'absolute', left, top: 0, flexDirection: 'row', gap: FIG_GAP }}>
                <MuscleFigure view="front" width={FIG_W} height={FIG_H} marks={marks} />
                <MuscleFigure view="back" width={FIG_W} height={FIG_H} marks={marks} />
              </View>
              {/* 吹き出しと印をつなぐ線（吹き出しが入らない狭い画面では、線も出さない） */}
              {calloutW >= 64 && (<Svg width={width} height={FIG_H + 8} style={StyleSheet.absoluteFill} pointerEvents="none">
                {[...leftOnes.map((p) => ({ p, from: calloutW })), ...rightOnes.map((p) => ({ p, from: width - calloutW }))].map(({ p, from }) => (
                  <Line key={p.injury.id} x1={from} y1={p.top + 8} x2={p.x} y2={p.y}
                    stroke={p.injury.status === 'fixing' ? INJURY_AMBER : colors.sub} strokeWidth={1} strokeOpacity={0.7} />
                ))}
              </Svg>)}
              {calloutW >= 64 && leftOnes.map((p) => (
                <Callout key={p.injury.id} injury={p.injury} number={numbers.get(p.injury.id) ?? ''} align="right" style={{ left: 0, top: p.top, width: calloutW }} />
              ))}
              {calloutW >= 64 && rightOnes.map((p) => (
                <Callout key={p.injury.id} injury={p.injury} number={numbers.get(p.injury.id) ?? ''} align="left" style={{ right: 0, top: p.top, width: calloutW }} />
              ))}
            </>
          )}
        </View>
        <View style={s.mapHead}>
          <View style={{ flexDirection: 'row', gap: space.l, marginLeft: left - space.s }}>
            <Mono>R FRONT L</Mono>
            <Mono>L BACK R</Mono>
          </View>
          {active > 0 && <Mono color={INJURY_AMBER}>{`▲ ${active} ALERT`}</Mono>}
        </View>
      </View>
    </ScanFrame>
  );
}

function Callout({ injury, number, align, style }: { injury: Injury; number: string; align: 'left' | 'right'; style: object }) {
  const fixing = injury.status === 'fixing';
  const tone = fixing ? INJURY_AMBER : colors.sub;
  return (
    <View style={[{ position: 'absolute', alignItems: align === 'right' ? 'flex-end' : 'flex-start' }, style]}>
      <Mono color={tone} size={11}>{`${number}${fixing ? ' ▲' : ''}`}</Mono>
      <T variant="labelL" numberOfLines={1}>{siteLabel(injury.site, injury.side)} <T num size={13} color={colors.sub}>{dotDate(injury.occurredOn)}</T></T>
      {whereText(injury) !== '' && <T size={11} color={colors.sub} numberOfLines={1} align={align}>{whereText(injury)}</T>}
      <T variant="labelS" color={fixing ? INJURY_AMBER : colors.accent} numberOfLines={2} align={align}>{`${fixing ? '●' : '○'} ${STATUS_NAMES[injury.status]}`}</T>
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

/**
 * 筋トレのタブの「ケガ」の中身：体の図、直している途中（カード）、直せた（行）。記録がなければ責めない一言。
 * 右下の「ケガを記録」は画面の側（タブの画面の FAB）
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
      <InjuryBodyMap injuries={data} numbers={numbers} />
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

const s = StyleSheet.create({
  fixedList: { backgroundColor: colors.card, borderRadius: radius.l, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  frame: { borderWidth: 1, borderRadius: radius.l, backgroundColor: colors.card, overflow: 'hidden' },
  mapHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radius.s, paddingHorizontal: space.s, paddingVertical: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  activeCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: colors.card, borderRadius: radius.l, borderWidth: 1,
    borderColor: toneColors.caution.container, borderLeftWidth: 4, borderLeftColor: INJURY_AMBER, padding: space.l, minHeight: 48,
  },
  fixedRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m, minHeight: 72 },
  fixedRing: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.accentMuted },
});
