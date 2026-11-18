import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CaptureForm } from '@/components/CaptureForm';
import { HandCard } from '@/components/HandCard';
import { Icon } from '@/components/Icon';
import { Button, Header, Screen, SectionTitle, T } from '@/components/ui';
import { InkSettle, Seal } from '@/components/wa';
import type { ListItem } from '@/db/repositories/words';
import { useData } from '@/hooks/data';
import { relativeTime, reviewDay } from '@/lib/date';
import { estimateSeconds } from '@/lib/listen/timerOutput';
import { listenQueue } from '@/lib/schedule';
import { buildScript, spokenText } from '@/lib/speech';
import { listenMinutes, thisWeek, weekLine, weekSeals } from '@/lib/stats';
import type { Source } from '@/lib/types';
import { colors, radius, space } from '@/theme';

/** 今日の手札に出す数 */
const HAND_ON_HOME = 3;
/** 最近拾ったに出す数 */
const RECENT_ON_HOME = 3;
/** 今週の落款に並べる数（それより多いときも、一文の「使えた M」で数は伝わる） */
const SEALS_ON_HOME = 6;

/** 最近拾ったの横（「Audible・3分前」「Claude から・本の写真・昨日」） */
function recentMeta(e: ListItem, sources: Source[], now: Date) {
  const src = sources.find((s) => s.id === e.firstSourceId)?.name;
  return [e.firstVia === 'mcp' ? 'Claude から' : null, src, relativeTime(e.created_at, now)].filter(Boolean).join(' · ');
}

/**
 * ホーム（下のタブの1番目）。上から、書き留める欄と「AI で拾う」、今週の一文と落款（押すと記録）、今日の手札、
 * 「手札を聞く」（聞くへ）、最近拾った。数は記録の画面と同じ計算（lib/stats.ts の activityStats）、
 * 手札の並びと聞くの数・分は聞くと同じ並び（lib/schedule.ts の listenQueue）と見積もり（estimateSeconds）。0 の週も責めない
 */
export default function HomeScreen() {
  const [savedId, setSavedId] = useState<string | null>(null);
  const { data } = useData(async (r) => {
    const today = reviewDay(new Date());
    const [items, usages, sources] = [await r.words.listAll(), await r.words.usages(), await r.catalog.sources()];
    const queue = listenQueue(items, today);
    let seconds = 0;
    for (const { expression: e } of queue) {
      const tags = (await r.words.tagsOf(e.id)).map((t) => ({ kind: t.kind, name: t.name, status: t.status }));
      seconds += estimateSeconds({ id: e.id, title: e.text, reading: e.reading, speech: spokenText(buildScript(e, tags)) });
    }
    const week = thisWeek(items, usages, today);
    return {
      today, sources, week, total: items.length,
      seals: weekSeals(items, usages, week),
      hand: queue.filter((x) => x.group === 'due' || x.group === 'hand').slice(0, HAND_ON_HOME).map((x) => x.expression),
      handTotal: items.filter((e) => e.place === 'hand').length,
      listen: { count: queue.length, minutes: listenMinutes(seconds) },
      recent: items.slice(0, RECENT_ON_HOME),
    };
  });
  const now = new Date();
  const line = data ? weekLine(data.week) : '';

  return (
    <Screen inTab testID="home-screen">
      <Header title="ことば" />
      <CaptureForm onSaved={setSavedId} />

      {data && (
        <>
          <Pressable
            accessibilityRole="button" accessibilityLabel={`${line}。記録を見る`} onPress={() => router.push('/records')}
            style={({ pressed }) => [s.week, pressed && { opacity: 0.7 }]} testID="home-week"
          >
            <View style={{ flex: 1, gap: space.s }}>
              <T variant="wordS" testID="home-week-line">{line}</T>
              {data.seals.length > 0 && (
                <View style={s.seals} testID="home-week-seals">
                  {data.seals.slice(0, SEALS_ON_HOME).map((e) => <Seal key={e.id} play={false} size={28} />)}
                </View>
              )}
            </View>
            <Icon name="chevronRight" size={20} color={colors.sub} />
          </Pressable>

          {data.total > 0 && (
            <>
              <SectionTitle title="今日の手札" right={data.handTotal > 0 ? (
                <Pressable accessibilityRole="link" accessibilityLabel={`手札 ${data.handTotal} 枚を見る`} onPress={() => router.navigate('/hand')} style={s.more} testID="home-open-hand">
                  <T variant="bodyS" color={colors.sub}>手札 {data.handTotal}</T>
                  <Icon name="chevronRight" size={18} color={colors.sub} />
                </Pressable>
              ) : undefined} />
              {data.hand.length > 0 ? (
                <View style={{ gap: space.m }} testID="home-hand">
                  {data.hand.map((e) => (
                    <HandCard key={e.id} e={e} sources={data.sources} today={data.today} style={s.card} testID="home-hand-card" />
                  ))}
                </View>
              ) : (
                <T variant="bodyS" color={colors.sub} testID="home-hand-empty">手札はまだ空です。使いたい言葉を、拾ったから入れられます</T>
              )}
            </>
          )}

          {data.listen.count > 0 && (
            <Button
              label={`手札を聞く（${data.listen.count} 語・約 ${data.listen.minutes} 分）`} icon="play" variant="outline"
              onPress={() => router.navigate('/listen')} style={{ marginTop: space.l }} testID="home-listen"
            />
          )}

          {data.recent.length > 0 && (
            <>
              <SectionTitle title="最近拾った" />
              <View testID="home-recent">
                {data.recent.map((e) => (
                  <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={e.text} onPress={() => router.push(`/word/${e.id}`)} style={s.recent} testID="recent-row">
                    <InkSettle play={e.id === savedId} style={{ flexShrink: 1 }}>
                      <T variant="word">{e.text}</T>
                    </InkSettle>
                    <T variant="label" color={colors.sub} numberOfLines={1} style={{ flexShrink: 1 }}>{recentMeta(e, data.sources, now)}</T>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  week: {
    flexDirection: 'row', alignItems: 'center', gap: space.m, marginTop: space.xxl, paddingVertical: space.l, paddingHorizontal: space.l,
    backgroundColor: colors.card, borderRadius: radius.l, borderWidth: 1, borderColor: colors.line, minHeight: 64,
  },
  seals: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  more: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  card: { flexBasis: 'auto', minHeight: 0 },
  recent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.l, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.line },
});
