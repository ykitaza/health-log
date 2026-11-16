import { router, useLocalSearchParams } from 'expo-router';
import { ReportDetail } from '@/components/report/ReportDetail';

/**
 * レポートの詳細（スタックの道 /reports/[id]）。中身はレポートのタブと同じ ReportDetail（components/report/ReportDetail.tsx）。
 * ホームの最新のレポートのカード・新しいレポートのお知らせ（1件）・今週やること・各タブの日のまとめのカードから、id を指して開く。
 * 戻るは、来た画面（ホームなど）へ戻る。URL で直接開いたとき（戻る先がない）は、ホームへ移る
 * （レポートのタブは最新の詳細をそのまま出すので、そこへ戻すより、いつもの入口のホームがよい）
 */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return <ReportDetail source={{ type: 'id', id }} onBack={back} />;
}
