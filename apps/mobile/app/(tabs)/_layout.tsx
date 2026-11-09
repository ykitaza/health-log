import { Tabs } from 'expo-router';
import { Easing, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from '@/components/Icon';
import { tabBarStyle } from '@/components/tabBar';
import { colors, fonts } from '@/theme';
import { duration, EASE_OUT } from '@/theme/motion';

function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return (
    <View style={{ width: 64, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colors.accentDark : 'transparent' }}>
      <Icon name={name} color={focused ? colors.accent : colors.sub} size={22} />
    </View>
  );
}

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'ホーム', icon: 'home' },
  { name: 'meals', title: '食事', icon: 'meal' },
  { name: 'history', title: '履歴／分析', icon: 'chart' },
  { name: 'body', title: '体組成', icon: 'scale' },
];

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  // タブの切り替えは、さりげなく重ねて切り替える（150ms）。動きを減らす設定なら切り替えるだけ
  const reduced = useReducedMotion();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: reduced ? 'none' : 'fade',
        transitionSpec: { animation: 'timing', config: { duration: duration.text, easing: Easing.bezier(...EASE_OUT) } },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.sub,
        tabBarStyle: tabBarStyle(insets.bottom),
        tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 11, marginTop: 4 },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{ title: t.title, tabBarIcon: ({ focused }) => <TabIcon name={t.icon} focused={focused} /> }}
        />
      ))}
    </Tabs>
  );
}
