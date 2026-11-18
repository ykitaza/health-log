import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Chip, Header, Screen, SectionTitle, T } from '@/components/ui';
import { Seal } from '@/components/wa';
import { useData } from '@/hooks/data';
import { reviewDay } from '@/lib/date';
import { activityStats, encouragement, formatDuration, Row, sealGallery, Unit } from '@/lib/stats';
import { colors, radius, space } from '@/theme';

/** 期間の見出し（週は始まりの日「11/16」、月は「11月」） */
const label = (r: Row, unit: Unit) => {
  const [, m, d] = r.from.split('-').map(Number);
  return unit === 'week' ? `${m}/${d}` : `${m}月`;
};

/** 静かな棒（いちばん多いところを高さいっぱいに。数は上に小さく） */
function Bars({ rows, unit }: { rows: Row[]; unit: Unit }) {
  const max = Math.max(1, ...rows.map((b) => b.captured));
  return (
    <View style={s.bars} testID="records-bars" accessible accessibilityLabel={rows.map((b) => `${label(b, unit)} ${b.captured}語`).join('、')}>
      {rows.map((b) => (
        <View key={b.from} style={s.barCol}>
          <T variant="caption" color={colors.sub}>{b.captured > 0 ? b.captured : ''}</T>
          <View style={[s.bar, { height: Math.max(2, (b.captured / max) * 96), backgroundColor: b.captured > 0 ? colors.accent : colors.line }]} />
          <T variant="caption" color={colors.faint} numberOfLines={1}>{label(b, unit)}</T>
        </View>
      ))}
    </View>
  );
}

/**
 * 記録（拾ったの「…」と設定から）。拾った数（週・月）、使えた数と自分の言葉の落款の並び、聞いた時間と言葉、出会った場所ごとの数。
 * 端末の記録（同期したもの）から、サーバーの stats と同じ計算をする（lib/stats.ts）。続けた日数や途切れた知らせは出さない（責めない）
 */
export default function RecordsScreen() {
  const [unit, setUnit] = useState<Unit>('week');
  const { data } = useData(async (r) => ({
    items: await r.words.listAll(), sources: await r.catalog.sources(), encounters: await r.words.allEncounters(),
    usages: await r.words.usages(), listens: await r.words.listenSessions(),
  }));
  const items = data?.items ?? [];
  const today = reviewDay(new Date());
  const stats = activityStats(items, data?.encounters ?? [], data?.usages ?? [], data?.listens ?? [], data?.sources ?? [], today, unit, unit === 'week' ? 8 : 6);
  const thisWeek = activityStats(items, [], [], [], [], today, 'week', 1).periods[0].captured;
  const seals = sealGallery(items);
  const allListens = data?.listens ?? [];
  const listenedSeconds = allListens.reduce((n, x) => n + x.seconds, 0);
  const listenedItems = allListens.reduce((n, x) => n + x.items, 0);
  const uses = items.reduce((n, e) => n + e.use_count, 0);
  const maxSource = Math.max(1, ...stats.captured_by_source.map((b) => b.captured));

  return (
    <Screen testID="records-screen">
      <Header title="記録" onBack={() => router.back()} />
      <T variant="wordS" testID="records-lead">{encouragement(items.length, thisWeek)}</T>

      <SectionTitle title="拾った" right={(
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Chip label="週" variant={unit === 'week' ? 'selected' : 'default'} onPress={() => setUnit('week')} testID="records-week" />
          <Chip label="月" variant={unit === 'month' ? 'selected' : 'default'} onPress={() => setUnit('month')} testID="records-month" />
        </View>
      )} />
      <Bars rows={stats.periods} unit={unit} />
      <T variant="label" color={colors.sub} style={{ marginTop: space.s }} testID="records-period">
        この{unit === 'week' ? '8週' : '6か月'}：拾った {stats.totals.captured} · また出会った {stats.totals.reencountered} · 手札に入れた {stats.totals.hand_entered}
      </T>

      <SectionTitle title="使えた" right={<T variant="bodyS" color={colors.sub} testID="records-uses">使えた {uses} 回 · 自分の言葉 {stats.now.own} 語</T>} />
      {seals.length === 0 ? (
        <T variant="bodyS" color={colors.sub}>言葉の詳細で「使えた」を押すと、ここに落款が押されます</T>
      ) : (
        <View style={s.gallery} testID="records-seals">
          {seals.map((e) => (
            <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`${e.text}、使えた ${e.use_count} 回`} onPress={() => router.push(`/word/${e.id}`)} style={s.sealCell}>
              <Seal play={false} size={40} />
              <T variant="wordS" style={{ fontSize: 15, lineHeight: 22, textAlign: 'center' }} numberOfLines={2}>{e.text}</T>
            </Pressable>
          ))}
        </View>
      )}

      <SectionTitle title="聞いた" />
      <View style={{ flexDirection: 'row', gap: space.xxl }} testID="records-listen">
        <View><T variant="label" color={colors.sub}>時間</T><T variant="word">{formatDuration(listenedSeconds)}</T></View>
        <View><T variant="label" color={colors.sub}>聞いた数</T><T variant="word">{listenedItems} 語</T></View>
      </View>

      <SectionTitle title="出会った場所" />
      <View style={{ gap: space.s }} testID="records-sources">
        {stats.captured_by_source.map((b) => (
          <View key={b.source} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <T variant="bodyS" style={{ width: 88 }} numberOfLines={1}>{b.source}</T>
            <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.line }}>
              <View style={{ width: `${(b.captured / maxSource) * 100}%`, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />
            </View>
            <T variant="bodyS" color={colors.sub} style={{ width: 40, textAlign: 'right' }}>{b.captured}</T>
          </View>
        ))}
        {stats.captured_by_source.length === 0 && <T variant="bodyS" color={colors.sub}>この期間はまだありません</T>}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, height: 140 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '70%', borderRadius: radius.s / 2 },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m },
  sealCell: { width: 88, alignItems: 'center', gap: space.xs, paddingVertical: space.s },
});
