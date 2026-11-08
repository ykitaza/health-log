import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from '@/components/Icon';
import { tabBarStyle } from '@/components/tabBar';
import { colors, fonts } from '@/theme';

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
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
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
