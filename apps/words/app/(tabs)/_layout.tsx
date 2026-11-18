import { Href, Redirect, router, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from '@/components/Icon';
import { T } from '@/components/ui';
import { useAuth } from '@/hooks/auth';
import { useRepos } from '@/hooks/data';
import { colors, space } from '@/theme';

/** 下のタブ（Figma の帯）：書き留める・拾った・手札・聞く（振り返りの画面は、運転中に聞く画面に変えた） */
const TABS: { name: string; href: Href; label: string; icon: IconName }[] = [
  { name: 'index', href: '/', label: '書き留める', icon: 'pencil' },
  { name: 'collected', href: '/collected', label: '拾った', icon: 'book' },
  { name: 'hand', href: '/hand', label: '手札', icon: 'cards' },
  { name: 'listen', href: '/listen', label: '聞く', icon: 'headphones' },
];

type BarProps = { state: { index: number; routes: { key: string; name: string }[] } };

function TabBar({ state }: BarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { paddingBottom: space.s + insets.bottom }]} accessibilityRole="tablist">
      {state.routes.map((route, i) => {
        const tab = TABS.find((t) => t.name === route.name);
        if (!tab) return null;
        const selected = state.index === i;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            aria-selected={selected}
            testID={`tab-${route.name}`}
            onPress={() => { if (!selected) router.navigate(tab.href); }}
            style={s.item}
          >
            <View style={[s.pill, selected && { backgroundColor: colors.wash }]}>
              <Icon name={tab.icon} size={24} color={selected ? colors.accent : colors.ink} />
            </View>
            <T variant="label" bold={selected}>{tab.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const repos = useRepos();
  const { status } = useAuth();
  // 初めの画面（ログインするか、ログインせずに使うか）を済ませていなければ、そちらを開く
  const [welcomed, setWelcomed] = useState<boolean | null>(null);
  useEffect(() => {
    repos.local.welcomed().then(setWelcomed).catch(() => setWelcomed(true));
  }, [repos]);
  if (welcomed === null || status === 'loading') return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  if (!welcomed && status !== 'signedIn') return <Redirect href="/welcome" />;
  return (
    <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.paper } }} tabBar={(props) => <TabBar {...(props as unknown as BarProps)} />}>
      {TABS.map((t) => <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />)}
    </Tabs>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.paper, paddingTop: space.m },
  item: { flex: 1, alignItems: 'center', gap: space.xs, minHeight: 56 },
  pill: { width: 64, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
