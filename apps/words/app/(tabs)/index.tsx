import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CaptureForm } from '@/components/CaptureForm';
import { Icon } from '@/components/Icon';
import { SettingsButton } from '@/components/SettingsButton';
import { Button, Header, Screen, T } from '@/components/ui';
import { InkSettle, Seal } from '@/components/wa';
import type { ListItem } from '@/db/repositories/words';
import { useData } from '@/hooks/data';
import { formatMonthDay, relativeTime, reviewDay } from '@/lib/date';
import { estimateSeconds } from '@/lib/listen/timerOutput';
import { listenQueue } from '@/lib/schedule';
import { buildScript, spokenText } from '@/lib/speech';
import { listenMinutes, thisWeek, weekLine, weekSeals } from '@/lib/stats';
import { HAND_LIMIT, Source } from '@/lib/types';
import { colors, radius, space } from '@/theme';

/** 今日の手札に出す数 */
const HAND_ON_HOME = 3;
/** 最近拾ったに出す数 */
const RECENT_ON_HOME = 3;

/** 最近拾ったの下（「Kindle · 『舟を編む』 · 今日」「Claude から · Audible · 昨日」） */
function recentMeta(e: ListItem, sources: Source[], now: Date) {
  const src = sources.find((s) => s.id === e.firstSourceId)?.name;
  const title = e.firstTitle ? `『${e.firstTitle.replace(/^『|』$/g, '')}』` : null;
  return [e.firstVia === 'mcp' ? 'Claude から' : null, src, title, relativeTime(e.created_at, now)].filter(Boolean).join(' · ');
}

/** 見出しの右の日付（「11月18日（水）」。日は午前4時で区切る） */
function dayLabel(today: string) {
  const [y, m, d] = today.split('-').map(Number);
  return `${formatMonthDay(today)}（${'日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
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
      <Header
        title="ことば"
        right={(
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <T variant="bodyS" color={colors.sub} testID="home-date">{data ? dayLabel(data.today) : ''}</T>
            <SettingsButton testID="home-settings" />
          </View>
        )}
      />
      <CaptureForm onSaved={setSavedId} />

      {data && (
        <>
          <Pressable
            accessibilityRole="button" accessibilityLabel={`${line}。記録を見る`} onPress={() => router.push('/records')}
            style={({ pressed }) => [s.week, pressed && { opacity: 0.7 }]} testID="home-week"
          >
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="label" color={colors.sub}>今週の一文</T>
              <T variant="wordS" style={{ fontSize: 20 }} testID="home-week-line">{line}</T>
              <T variant="label" color={colors.accent}>記録を見る ›</T>
            </View>
            {data.seals.length > 0 && (
              <View testID="home-week-seals"><Seal play={false} size={48} /></View>
            )}
          </Pressable>

          {data.total > 0 && (
            <>
              <View style={s.sectionHead}>
                <T variant="section" accessibilityRole="header">今日の手札</T>
                <Pressable accessibilityRole="link" accessibilityLabel={`手札 ${data.handTotal} / ${HAND_LIMIT}。手札を見る`} onPress={() => router.navigate('/hand')} style={s.more} testID="home-open-hand">
                  <T variant="bodyS" color={colors.sub}>手札 {data.handTotal} / {HAND_LIMIT}</T>
                </Pressable>
              </View>
              {data.hand.length > 0 ? (
                <View testID="home-hand">
                  {data.hand.map((e) => (
                    <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`${e.text}、手札${e.star ? '、★' : ''}`} onPress={() => router.push(`/word/${e.id}`)}
                      style={({ pressed }) => [s.handRow, pressed && { opacity: 0.6 }]} testID="home-hand-card">
                      <T variant="word" numberOfLines={1} style={{ flex: 1 }}>{e.text}</T>
                      <T variant="label" color={colors.accent}>手札</T>
                      {e.star && <Icon name="star" size={20} color={colors.sub} />}
                    </Pressable>
                  ))}
                </View>
              ) : (
                <T variant="bodyS" color={colors.sub} testID="home-hand-empty">手札はまだ空です。使いたい言葉を、拾ったから入れられます</T>
              )}
            </>
          )}

          {data.listen.count > 0 && (
            <Button
              label={`手札を聞く（${data.listen.count} 語・約 ${data.listen.minutes} 分）`} icon="play"
              onPress={() => router.navigate('/listen')} style={{ marginTop: space.l }} testID="home-listen"
            />
          )}

          {data.recent.length > 0 && (
            <>
              <View style={[s.sectionHead, { marginTop: space.xl }]}>
                <T variant="section" accessibilityRole="header">最近拾った</T>
                <Pressable accessibilityRole="link" accessibilityLabel="拾ったをすべて見る" onPress={() => router.navigate('/collected')} style={s.more} testID="home-open-collected">
                  <T variant="bodyS" color={colors.sub}>すべて見る ›</T>
                </Pressable>
              </View>
              <View testID="home-recent">
                {data.recent.map((e) => (
                  <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={e.text} onPress={() => router.push(`/word/${e.id}`)} style={s.recent} testID="recent-row">
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                      <InkSettle play={e.id === savedId} style={{ flex: 1 }}>
                        <T variant="word" numberOfLines={2}>{e.text}</T>
                      </InkSettle>
                      {e.place === 'hand' && <T variant="label" color={colors.accent}>手札</T>}
                    </View>
                    <T variant="label" color={colors.sub} numberOfLines={1}>{recentMeta(e, data.sources, now)}</T>
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
    flexDirection: 'row', alignItems: 'center', gap: space.m, marginTop: space.l, paddingVertical: space.m, paddingHorizontal: space.l,
    backgroundColor: colors.card, borderRadius: radius.l, borderWidth: 1, borderColor: colors.line, minHeight: 64,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.m },
  more: { minHeight: 44, justifyContent: 'center' },
  handRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52 },
  recent: { paddingVertical: space.s, gap: 2, minHeight: 56, justifyContent: 'center' },
});
