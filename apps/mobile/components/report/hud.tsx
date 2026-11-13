// レポート詳細画面（app/reports/[id].tsx と components/report/*）だけの見た目の部品。
// 承認済みのモック（ブランチ docs/report-mock の docs/report-mock/index.html。Issue #203）の文法：
// 近黒のフラットなパネル＋1px の枠、角の切り欠き（左上と右下）、等幅の英字マイクロラベル、密な2段のステータス行
// （英字の小ラベル＋和文／値は右）、色はミント（colors.accent）とモノクロだけ、装飾の効果はなし。
// テーマの共通の値（colors.card・radius.card・toneColors）はほかの画面と共用なので変えず、この画面の色はここに置く（値はモックの CSS 変数）。
// 角の切り欠きは CSS の clip-path ではなく react-native-svg の多角形で描く（Android でも同じ形になる）
import { useFonts } from 'expo-font';
import { createContext, ReactNode, useContext, useState } from 'react';
import { StyleProp, TextStyle, View, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Polygon, Polyline } from 'react-native-svg';
import { fmt1 } from '@/lib/units';
import { colors } from '@/theme';
import { T } from '../Text';

/** モックの色（:root の変数）。ミントは colors.accent と同じ値 */
export const hud = {
  /** 画面の地（--bg） */
  bg: '#080A09',
  /** パネルの地（--panel） */
  panel: '#0E1210',
  /** 一段暗い面（--panel2）：タブの入れ物、解釈の文、チェックの箱 */
  panel2: '#0B0F0D',
  /** パネルの枠（--line） */
  line: '#2E3A32',
  /** 薄い枠・表の見出しの下の線（--line2） */
  line2: '#232B26',
  /** 表の行のあいだの線 */
  rowLine: '#1C231E',
  /** 本文（--ink） */
  ink: '#E6EDE8',
  /** 補足（--muted） */
  muted: '#8A9A8F',
  /** 英字の小ラベル（--faint） */
  faint: '#5F6F65',
  /** 緑の英字の小ラベル（.micro.g） */
  microGreen: '#7AA88A',
  /** 和文のラベル（.s-label .ja など） */
  label: '#CBD5CE',
  /** 説明の文（.hero-note、.f-text） */
  note: '#B7C2BA',
  /** 解釈の文（.insight） */
  insight: '#DCE3DE',
  /** リングのトラック（.ring-bg） */
  ringTrack: '#222B25',
  /** 棒のトラック（.goal-track） */
  barTrack: '#1E2621',
  /** ミントの上の文字 */
  onGreen: '#06130C',
  white: '#FFFFFF',
  green: colors.accent,
} as const;

/** 等幅の字（Share Tech Mono）。読み込む前・読み込めなかったときはシステムの monospace */
const MonoContext = createContext<string>('monospace');

/**
 * Share Tech Mono（assets/fonts、SIL OFL 1.1）を JS から読み込み、子に配る。ネイティブの依存は足さない（expo-font は入っている）。
 * 読み込みを待たずに描き、読み込めたら等幅の字に替える
 */
export function HudFonts({ children }: { children: ReactNode }) {
  const [loaded] = useFonts({ ShareTechMono: require('../../assets/fonts/ShareTechMono-Regular.ttf') });
  return <MonoContext.Provider value={loaded ? 'ShareTechMono' : 'monospace'}>{children}</MonoContext.Provider>;
}

export const useMono = () => useContext(MonoContext);

/** 等幅の字の文字。数字と英字に使う（和文は Noto Sans JP のまま） */
export function Mono({ children, size = 14, color = hud.ink, spacing = 0, style, ...rest }: {
  children: ReactNode; size?: number; color?: string; spacing?: number; style?: StyleProp<TextStyle>;
  numberOfLines?: number; testID?: string; accessibilityLabel?: string;
}) {
  const family = useMono();
  return (
    <T {...rest} color={color} style={[{ fontFamily: family, fontSize: size, letterSpacing: spacing, fontVariant: ['tabular-nums'] }, style]}>
      {children}
    </T>
  );
}

/** 英字のマイクロラベル（.micro：9px、字間 .18em、大文字）。green で緑（.micro.g） */
export function Micro({ children, green = false, color, style }: { children: string; green?: boolean; color?: string; style?: StyleProp<TextStyle> }) {
  return (
    <Mono size={9} spacing={1.6} color={color ?? (green ? hud.microGreen : hud.faint)} style={[{ lineHeight: 13 }, style]}>
      {children.toUpperCase()}
    </Mono>
  );
}

/**
 * パネル（.card）：近黒の地と 1px の枠、左上と右下の角を cut だけ斜めに切る。
 * 大きさは onLayout で測り、測るまでは切り欠きのない四角で描く
 */
export function Panel({ children, style, cut = 8, bg = hud.panel, border = hud.line, testID, accessibilityLabel, accessible }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; cut?: number; bg?: string; border?: string; testID?: string; accessibilityLabel?: string;
  /** true で中身を1つにまとめて読ませる（タイル・札など）。中の行を読ませるパネルでは付けない */
  accessible?: boolean;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <View
      testID={testID}
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setSize((p) => (p && p.w === w && p.h === h ? p : { w, h }));
      }}
      style={[size ? null : { backgroundColor: bg, borderWidth: 1, borderColor: border }, { padding: size ? 1 : 0 }, style]}
    >
      {size && <NotchBox w={size.w} h={size.h} cut={cut} bg={bg} border={border} />}
      {children}
    </View>
  );
}

/** 切り欠きのある箱の絵（後ろに敷く）。枠は斜めの辺には引かない（モックの clip-path と同じ見え方） */
function NotchBox({ w, h, cut, bg, border }: { w: number; h: number; cut: number; bg: string; border: string | null }) {
  const c = Math.min(cut, w / 2, h / 2);
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      <Polygon points={`${c},0 ${w},0 ${w},${h - c} ${w - c},${h} 0,${h} 0,${c}`} fill={bg} />
      {border && (
        <>
          <Polyline points={`${c},0.5 ${w - 0.5},0.5 ${w - 0.5},${h - c}`} fill="none" stroke={border} strokeWidth={1} />
          <Polyline points={`${w - c},${h - 0.5} 0.5,${h - 0.5} 0.5,${c}`} fill="none" stroke={border} strokeWidth={1} />
        </>
      )}
    </Svg>
  );
}

/** 切り欠きのある小さな面（チップ・チェックの箱・日のマス）。枠なしの塗りか、枠だけ */
export function NotchChip({ children, fill, border, cut = 6, style }: {
  children?: ReactNode; fill?: string; border?: string; cut?: number; style?: StyleProp<ViewStyle>;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <View
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setSize((p) => (p && p.w === w && p.h === h ? p : { w, h }));
      }}
      style={[{ alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {size && <NotchBox w={size.w} h={size.h} cut={cut} bg={fill ?? 'transparent'} border={border ?? null} />}
      {children}
    </View>
  );
}

/** 表の頭（.week-table-head）：左に緑のマイクロラベル、右にマイクロラベル。下に線 */
export function TableHead({ left, right }: { left: string; right?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: hud.line2 }}>
      <Micro green>{left}</Micro>
      {right ? <Micro>{right}</Micro> : null}
    </View>
  );
}

/** パネルの見出し（緑のマイクロラベル＋太い和文の題、右に補足） */
export function PanelHead({ en, title, right, rightNode }: { en: string; title: string; right?: string; rightNode?: ReactNode }) {
  return (
    <View>
      <Micro green>{en}</Micro>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <T bold size={13} color={hud.ink} accessibilityRole="header">{title}</T>
        {rightNode ?? (right ? <T size={11.5} color={hud.muted}>{right}</T> : null)}
      </View>
    </View>
  );
}

/**
 * 2段のステータス行（.s-row）：左に英字の小ラベルと和文のラベル、右に値。行の下に細い線（last は引かない）。
 * value が文字なら等幅の白で、ReactNode ならそのまま置く
 */
export function StatusRow({ en, ja, value, last = false, wide = false, accessibilityLabel, testID }: {
  en: string; ja: string; value: ReactNode; last?: boolean; wide?: boolean; accessibilityLabel?: string; testID?: string;
}) {
  return (
    <View
      accessible={accessibilityLabel != null}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 7, borderBottomWidth: last ? 0 : 1, borderBottomColor: hud.rowLine }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Micro style={{ letterSpacing: 1.4 }}>{en}</Micro>
        <T bold size={12.5} color={hud.label} style={{ lineHeight: 17 }}>{ja}</T>
      </View>
      <View style={{ maxWidth: wide ? '62%' : '75%', flexShrink: 1, alignItems: 'flex-end' }}>
        {typeof value === 'string' ? <Mono size={14} color={hud.white} style={{ textAlign: 'right' }}>{value}</Mono> : value}
      </View>
    </View>
  );
}

/** 値と小さな単位（「69.8 KG」）。unit は大文字の等幅の小さな字 */
export function ValUnit({ value, unit, dim, color = hud.white }: { value: string; unit?: string; dim?: string; color?: string }) {
  return (
    <T style={{ textAlign: 'right' }}>
      <Mono size={14} color={color}>{value}</Mono>
      {dim ? <Mono size={12} color={hud.muted}>{` / ${dim}`}</Mono> : null}
      {unit ? <Mono size={10} color={hud.muted}>{` ${unit}`}</Mono> : null}
    </T>
  );
}

/** 表の値に和文を置く（.s-val.jp） */
export function JaVal({ children, weight = 'bold', size = 13, color = hud.ink }: { children: string; weight?: 'bold' | 'regular'; size?: number; color?: string }) {
  return <T bold={weight === 'bold'} size={size} color={color} style={{ textAlign: 'right', lineHeight: size * 1.5 }}>{children}</T>;
}

/** 解釈の文（.insight）：一段暗い面に、少し大きな文 */
export function Insight({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Panel bg={hud.panel2} border={hud.line2} cut={6} style={{ paddingHorizontal: 12, paddingVertical: 10 }} testID={testID}>
      <T size={14} color={hud.insight} style={{ lineHeight: 23 }}>{children}</T>
    </Panel>
  );
}

/** 円の進み具合（リング）。ratio 0〜1。端は角（butt）、トラックは --ring-bg */
export function Ring({ size, stroke, ratio, children }: { size: number; stroke: number; ratio: number | null; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = ratio == null ? 0 : Math.min(1, Math.max(0, ratio));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={hud.ringTrack} strokeWidth={stroke} />
        {p > 0 && <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={hud.green} strokeWidth={stroke} strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - p)} />}
      </Svg>
      <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

/** 細い折れ線（.spark）。values を左から右へ、最後の点に丸 */
export function Spark({ values, height, strokeWidth = 1.5 }: { values: number[]; height: number; strokeWidth?: number }) {
  const [w, setW] = useState(0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 4;
  const span = max - min || 1;
  const pts = values.map((v, i) => ({
    x: values.length === 1 ? w - pad : pad / 2 + (i / (values.length - 1)) * (w - pad * 1.5),
    y: pad + (1 - (v - min) / span) * (height - pad * 2),
  }));
  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && values.length >= 2 && (
        <Svg width={w} height={height}>
          <Path d={pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={hud.green} strokeWidth={strokeWidth} />
          <Circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3} fill={hud.green} />
        </Svg>
      )}
    </View>
  );
}

/**
 * 目標の棒（.goal-track / .big-track）：トラックに届いた分のミント、節目の白い目盛り（tick が null なら出さない）。
 * big で太い棒（10px）と高い目盛り
 */
export function GoalTrack({ ratio, tick, big = false, testIDTick }: { ratio: number; tick: number | null; big?: boolean; testIDTick?: string }) {
  const h = big ? 10 : 6;
  const pct = (x: number) => `${Math.round(Math.min(1, Math.max(0, x)) * 1000) / 10}%` as const;
  return (
    <View style={{ height: h, backgroundColor: hud.barTrack, borderWidth: 1, borderColor: hud.line2 }}>
      <View style={{ height: '100%', width: pct(ratio), backgroundColor: hud.green }} />
      {tick != null && (
        <View testID={testIDTick} style={{ position: 'absolute', top: big ? -5 : -4, left: pct(tick), width: 2, height: big ? 18 : 12, marginLeft: big ? -1 : 0, backgroundColor: hud.ink }} />
      )}
    </View>
  );
}

/** 枠だけの小さな札（.milestone / .hero-pill / .f-badge） */
export function OutlineTag({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ borderWidth: 1, borderColor: hud.line, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' }, style]}>{children}</View>;
}

/** 和文の中の切りのよい重さ（70.0 → 70、69.8 → 69.8。モックの「70kgまで」「目標：80kg」） */
export const kgLabel = (n: number) => fmt1(n).replace(/\.0$/, '');
/** 週あたりの傾向（小数2桁、符号つき。マイナスは「−」） */
export const pace2 = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(2)}`;

/** 日付を 2026.11.12 の形に */
export const dotDate = (key: string) => key.replace(/-/g, '.');
/** 日付を 11.12 の形に */
export const dotMonthDay = (key: string) => key.slice(5).replace('-', '.');

/** 期間タブの選んだ面（モックの .tab[aria-selected]）：左上を切り、右下へ斜めに落とした形のミントの塗り */
export function SlantFill({ children, on, style }: { children: ReactNode; on: boolean; style?: StyleProp<ViewStyle> }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <View
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setSize((p) => (p && p.w === w && p.h === h ? p : { w, h }));
      }}
      style={[{ alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {on && size && (
        <Svg width={size.w} height={size.h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
          <Polygon points={`6,0 ${size.w},0 ${size.w - 6},${size.h} 0,${size.h} 0,6`} fill={hud.green} />
        </Svg>
      )}
      {children}
    </View>
  );
}
