// レポート詳細画面（app/reports/[id].tsx と、その画面専用のブロック）だけの見た目。
// 決まったモック（hlogレポート画面モック）の文法：近黒のフラットなパネル＋1px の枠、角はほぼ直角、
// 余白は密、英字のマイクロラベル、色はミント（colors.accent）とモノクロだけ。
// テーマの共通トークン（colors.card・radius.card・toneColors）はほかの画面と共用なので変えず、
// この画面でだけ使う色と部品をここに置く（モックの --panel #0E1210 / --panel2 #0B0F0D に対応）
import { View, ViewStyle } from 'react-native';
import { colors, fonts } from '@/theme';
import { T } from '../Text';

/** パネルの地。画面の地（colors.bg）よりわずかに持ち上げた近黒 */
export const REPORT_PANEL_BG = '#0E1210';
/** 一段暗い面。パネルの中の小さな面（アイコンの箱・タブの地など） */
export const REPORT_PANEL_BG2 = '#0B0F0D';
/** 棒とリングのトラックの地（モックの #1E2621） */
export const REPORT_TRACK_BG = '#1E2621';

/** レポート詳細のパネル：フラットな近黒＋1px の枠＋ほぼ直角。padding と gap は呼び出し側で足す */
export const reportPanelStyle: ViewStyle = {
  backgroundColor: REPORT_PANEL_BG,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 2,
};

/** 英字のマイクロラベル（BarlowCondensed、字間広め）。文言は呼び出し側が英字で渡す */
export function ReportMicro({ children, accent = false }: { children: string; accent?: boolean }) {
  return (
    <T style={{ fontFamily: fonts.num, fontSize: 10, letterSpacing: 1.8 }} color={accent ? colors.accentMuted : colors.sub}>
      {children}
    </T>
  );
}

/** パネルの見出し：マイクロラベル＋日本語の題、右に補足（期間など） */
export function ReportPanelHead({ en, title, right }: { en: string; title: string; right?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <ReportMicro>{en}</ReportMicro>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <T bold size={17} accessibilityRole="header">{title}</T>
        {right ? <T size={13} color={colors.sub}>{right}</T> : null}
      </View>
    </View>
  );
}
