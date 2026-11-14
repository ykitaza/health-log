import { router } from 'expo-router';
import { View } from 'react-native';
import { LoadError } from '@/components/LoadError';
import { ActionRow, PhaseFrame } from '@/components/phase/parts';
import { hud, Panel } from '@/components/report/hud';
import { T } from '@/components/Text';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { formatShortDate } from '@/lib/date';
import { phaseLabel } from '@/lib/phases';
import { endedPhases } from '@/lib/phaseReview';
import { phaseLastDay } from '@/lib/phaseView';

/** これまでのフェーズ（終えた通常のフェーズ。中断したもの・療養は入れない）。押すと振り返りの画面。設定の「これまでのフェーズ」から開く */
export default function PhaseHistoryScreen() {
  const today = useToday();
  const { data, error, reload } = useFocusData(async (r) => {
    const [phases, reports] = await Promise.all([r.phases.list(), r.reports.listWithoutBody()]);
    const reviewed = new Set(reports.flatMap((x) => (x.kind === 'phase' && x.phaseId ? [x.phaseId] : [])));
    return { ended: endedPhases(phases), reviewed };
  }, today);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <PhaseFrame sys="KARADA // PHASE HISTORY" onBack={close} testID="phase-history">
      <T bold size={20} color={hud.ink} accessibilityRole="header" style={{ marginTop: 2 }}>これまでのフェーズ</T>
      {error ? <LoadError onRetry={reload} /> : !data ? <View /> : data.ended.length === 0 ? (
        <T size={13} color={hud.muted}>終えたフェーズはまだありません。</T>
      ) : (
        <Panel style={{ paddingHorizontal: 14, paddingVertical: 2 }}>
          {data.ended.map((p, i) => (
            <ActionRow
              key={p.id} title={phaseLabel(p)} last={i === data.ended.length - 1}
              sub={`${formatShortDate(p.startDate)}〜${formatShortDate(phaseLastDay(p, today))}`}
              right={data.reviewed.has(p.id) ? '振り返りあり' : undefined}
              onPress={() => router.push(`/phase/review/${p.id}`)} testID={`phase-history-${p.id}`}
            />
          ))}
        </Panel>
      )}
    </PhaseFrame>
  );
}
