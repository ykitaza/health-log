import { router } from 'expo-router';
import { PhasePending } from '@/components/PhasePending';

/** フェーズの進み具合（仮の画面）。ホームのフェーズの 1 行（実施中・療養中）から開く。中身は次の PR で作る */
export default function PhaseScreen() {
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return <PhasePending title="フェーズの進み具合" onBack={back} testID="phase-progress" />;
}
