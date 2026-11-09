import { Tabs } from 'expo-router';
import { Easing } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconName } from '@/components/Icon';
import { tabBarStyle } from '@/components/tabBar';
import { TabButton } from '@/components/TabItem';
import { duration, EASE_OUT } from '@/theme/motion';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'ホーム', icon: 'home' },
  { name: 'training', title: '筋トレ', icon: 'dumbbell' },
  { name: 'meals', title: '食事', icon: 'meal' },
  { name: 'body', title: 'からだ', icon: 'scale' },
];

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  // タブの画面の切り替えは、重ねて切り替える（行き帰り同じ 250ms）。動きを減らす設定なら切り替えるだけ
  const reduced = useReducedMotion();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: reduced ? 'none' : 'fade',
        transitionSpec: { animation: 'timing', config: { duration: duration.toggle, easing: Easing.bezier(...EASE_OUT) } },
        tabBarStyle: tabBarStyle(insets.bottom),
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          // アイコン・印・ラベルは、波紋を出さない自前のボタンで描く
          options={{ title: t.title, tabBarButton: (props) => <TabButton {...props} icon={t.icon} label={t.title} /> }}
        />
      ))}
    </Tabs>
  );
}
