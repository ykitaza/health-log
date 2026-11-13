import { router } from 'expo-router';
import { PhasePending } from '@/components/PhasePending';

/** フェーズを始める（仮の画面）。ホームのフェーズの 1 行（未設定）から開く。中身は次の PR で作る */
export default function PhaseNewScreen() {
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return <PhasePending title="フェーズを始める" onBack={back} testID="phase-new" />;
}
