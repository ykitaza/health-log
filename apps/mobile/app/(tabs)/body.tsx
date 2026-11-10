import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BodyInputPatch, BodyInputSheet } from '@/components/BodyInputSheet';
import { BodyTrend } from '@/components/BodyTrend';
import { takeBodyInputRequest } from '@/components/home';
import { Icon, IconName } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { PressableScale, RollNumber } from '@/components/motion';
import { DailyHighlights } from '@/components/reports';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Button, Card, IconButton, PrimaryTabs, TabHeader } from '@/components/ui';
import { useBackToToday } from '@/hooks/backToToday';
import { useFocusData } from '@/hooks/data';
import { useHealthConnect } from '@/hooks/healthConnect';
import { useToday } from '@/hooks/today';
import { BodyMetric, bmi, DailyBody, goalProgress, leanMass, previousWeight, weekAverage } from '@/lib/body';
import { addDays, formatJpDate, formatMonthDay, todayKey } from '@/lib/date';
import { formatClock, formatHeartRate, formatHM, formatMinutes, formatSteps } from '@/lib/health';
import { TAB_AREAS } from '@/lib/reports';
import { fmt1, kgToUnit, WeightUnit } from '@/lib/units';
import { colors, radius, space } from '@/theme';

type Pane = 'today' | 'trend';

/**
 * からだのタブ。上の切り替え（M3 の primary tabs）で「今日」と「推移」を分ける。
 * 今日はその日の計測を見る画面（体重、週の平均、目標までの残り、体脂肪率・除脂肪体重・BMI、取り込んだ睡眠・心拍・歩数）。入れるのは下からのシート。
 * 推移は体重（7日の平均・目標）、目標体重まで、睡眠・安静時心拍・歩数の直近7日
 */
export default function BodyScreen() {
  const [pane, setPane] = useState<Pane>('today');
  const [date, setDate] = useState(todayKey);
  const [editing, setEditing] = useState(false);
  const hc = useHealthConnect();
  // 日をまたいだら、今日を見ていたなら新しい今日へ移す（前の日に記録を足さないように）
  const today = useToday((next, prev) => setDate((d) => (d === prev ? next : d)));
  // 前の日を見ているときは、Android の戻るでまず今日に戻す
  useBackToToday(pane !== 'today' || date === today, () => setDate(today));
  // ホームの体調のカードから、その日を指定して開いたとき
  const { date: asked } = useLocalSearchParams<{ date?: string }>();
  useEffect(() => { if (asked && asked <= todayKey()) { setDate(asked); setPane('today'); } }, [asked]);
  // ホームの「記録する」の体重から開いたときは、その日に移り、その日の値を読んでから計測のシートを出す
  const [inputAsked, setInputAsked] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    const d = takeBodyInputRequest();
    if (d && d <= todayKey()) { setDate(d); setPane('today'); setInputAsked(d); }
  }, []));

  const { data, error: loadError, reload, repos } = useFocusData(async (r) => {
    const from = addDays(today, -6);
    const [daily, settings, sleep, heart, steps, imported, sleepWeek, heartWeek, stepWeek] = await Promise.all([
      r.body.listDaily(), r.settings.get(), r.health.sleepDay(date), r.health.heartRateDay(date), r.health.stepDay(date), r.body.getImportedDay(date),
      r.health.sleepDays(from, today), r.health.heartRateDays(from, today), r.health.stepDays(from, today),
    ]);
    return { date, daily, settings, sleep, heart, steps, imported, sleepWeek, heartWeek, stepWeek };
  }, `${date}|${today}`);
  const unit = data?.settings.weightUnit ?? 'kg';
  const day = data?.daily.find((d) => d.date === date) ?? null;
  // 歩数の許可がない（前の APK か、許可をまだ出していない）ときは、記録がない日にそう出す
  const stepsBlocked = hc.connected && hc.stepsGranted === false;
  const askedReady = inputAsked != null && inputAsked === date && data?.date === date;
  useEffect(() => { if (askedReady) { setInputAsked(null); setEditing(true); } }, [askedReady]);

  const save = async (patch: BodyInputPatch) => {
    if (Object.keys(patch).length > 0) await repos.body.saveManual(date, patch);
    setEditing(false);
    await reload();
  };

  if (loadError) return <Screen tab><LoadError onRetry={reload} /></Screen>;

  return (
    <Screen tab>
      <TabHeader title="からだ" />
      <PrimaryTabs<Pane>
        options={[{ key: 'today', label: '今日', icon: 'scale' }, { key: 'trend', label: '推移', icon: 'chart' }]}
        value={pane}
        onChange={setPane}
      />
      {pane === 'trend' ? (
        data && (
          <BodyTrend daily={data.daily} settings={data.settings} sleep={data.sleepWeek} heart={data.heartWeek} steps={data.stepWeek} today={today} />
        )
      ) : (<>
        <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.xs, paddingHorizontal: space.xs, marginTop: space.l }}>
          <IconButton name="prev" label="前の日" onPress={() => setDate(addDays(date, -1))} />
          <T variant="titleM">{formatJpDate(date)}</T>
          <IconButton name="next" label="次の日" disabled={date >= today} onPress={() => date < today && setDate(addDays(date, 1))} />
        </Card>

        {data && (
          <WeightCard
            date={date} day={day} daily={data.daily} unit={unit}
            heightCm={data.settings.heightCm ?? null} goalKg={data.settings.goalWeightKg ?? null}
            onEdit={() => setEditing(true)}
          />
        )}

        {/* 取り込んだ睡眠・心拍・歩数。押すとそれぞれの推移（記録がなければ、Health Connect をつなぐ導線） */}
        <Card style={{ marginTop: space.m, padding: 0 }}>
          <HealthRow
            testID="sleep-day"
            icon="moon"
            title="睡眠"
            sub={data?.sleep ? `${formatClock(data.sleep.mainStartAt)}〜${formatClock(data.sleep.mainEndAt)}${data.sleep.sessions > 1 ? `（ほか${data.sleep.sessions - 1}回）` : ''}` : 'この日の記録はありません'}
            value={data?.sleep ? formatHM(data.sleep.asleepMin) : '—'}
            unit={data?.sleep ? '時間:分' : ''}
            label={data?.sleep ? `睡眠 ${formatMinutes(data.sleep.asleepMin)}。睡眠の推移を見る` : '睡眠の推移を見る'}
            onPress={() => router.push({ pathname: '/health-trend', params: { kind: 'sleep' } })}
          />
          <HealthRow
            testID="heart-day"
            icon="heart"
            title="心拍"
            sub={data?.heart?.avgBpm != null ? formatHeartRate({ ...data.heart, restingBpm: null }).replace(' 拍/分', '') : 'この日の記録はありません'}
            lead={data?.heart?.restingBpm != null ? '安静時' : undefined}
            value={data?.heart?.restingBpm != null ? String(Math.round(data.heart.restingBpm)) : '—'}
            unit={data?.heart?.restingBpm != null ? 'bpm' : ''}
            label={data?.heart ? `心拍 ${formatHeartRate(data.heart)}。安静時心拍の推移を見る` : '安静時心拍の推移を見る'}
            onPress={() => router.push({ pathname: '/health-trend', params: { kind: 'heart' } })}
            line
          />
          <HealthRow
            testID="steps-day"
            icon="steps"
            title="歩数"
            sub={data?.steps ? '1日の合計' : stepsBlocked ? '新しいアプリで許可すると取り込めます' : 'この日の記録はありません'}
            value={data?.steps ? formatSteps(data.steps.steps) : '—'}
            unit={data?.steps ? '歩' : ''}
            label={data?.steps
              ? `歩数 1日の合計 ${formatSteps(data.steps.steps)} 歩。歩数の推移を見る`
              : `歩数。${stepsBlocked ? '新しいアプリを入れて歩数を許可すると取り込めます' : 'この日の記録はありません'}。歩数の推移を見る`}
            onPress={() => router.push({ pathname: '/health-trend', params: { kind: 'steps' } })}
            line
          />
        </Card>
        <DailyHighlights date={date} areas={TAB_AREAS.body} />
      </>)}

      <BodyInputSheet
        visible={editing}
        date={date}
        day={day}
        imported={data?.date === date ? data.imported : null}
        unit={unit}
        onClose={() => setEditing(false)}
        onSave={save}
      />
    </Screen>
  );
}

const openTrend = (metric: BodyMetric) => router.push({ pathname: '/body-trend', params: { metric } });

/**
 * その日の体重のカード。記録がある日は、体重（取り込みなら印）、週の平均と目標までの残り、体脂肪率・除脂肪体重・BMI のタイル、メモ。
 * 記録がない日は、そう書き、前回の体重と「計測を入れる」
 */
function WeightCard({ date, day, daily, unit, heightCm, goalKg, onEdit }: {
  date: string; day: DailyBody | null; daily: DailyBody[]; unit: WeightUnit; heightCm: number | null; goalKg: number | null; onEdit: () => void;
}) {
  if (!day) {
    const prev = previousWeight(daily, date);
    return (
      <Card style={{ marginTop: space.m }}>
        <T variant="bodyM" color={colors.sub}>体重</T>
        <T variant="titleM" style={{ marginTop: space.xs }}>この日の記録はありません</T>
        {prev && (
          <T variant="bodyM" color={colors.sub} style={{ marginTop: space.xs }}>
            前回 {fmt1(kgToUnit(prev.weightKg, unit))} {unit}（{formatMonthDay(prev.date)}）
          </T>
        )}
        <Button label="計測を入れる" icon="plus" variant="text" small onPress={onEdit} testID="body-add" style={{ alignSelf: 'flex-start', marginTop: space.s, marginLeft: -12, paddingLeft: 12 }} />
      </Card>
    );
  }
  const w = day.weightKg;
  const weights = daily.filter((d) => d.weightKg != null).map((d) => ({ date: d.date, value: d.weightKg! }));
  const week = weekAverage(weights, date);
  const progress = w != null && goalKg != null ? goalProgress(w, goalKg, null) : null;
  const summary = [
    week != null ? `週の平均 ${fmt1(kgToUnit(week, unit))} ${unit}` : null,
    progress ? (progress.direction === 'reached' ? '目標に届きました' : `目標まで あと ${fmt1(kgToUnit(progress.remaining, unit))} ${unit}`) : null,
  ].filter(Boolean).join(' ・ ');
  const lean = leanMass(w, day.bodyFatPct);
  const b = bmi(w, heightCm);
  const tiles: { label: string; value: string; unit: string; metric: BodyMetric; hint?: string }[] = [
    { label: '体脂肪率', value: day.bodyFatPct == null ? '—' : fmt1(day.bodyFatPct), unit: day.bodyFatPct == null ? '' : '%', metric: 'bodyFat' },
    { label: '除脂肪体重', value: lean == null ? '—' : fmt1(kgToUnit(lean, unit)), unit: lean == null ? '' : unit, metric: 'leanMass' },
    { label: 'BMI', value: b == null ? '—' : fmt1(b), unit: '', metric: 'bmi', hint: heightCm == null ? '設定で身長を入れると出ます' : undefined },
  ];
  return (
    <Card style={{ marginTop: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -space.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <T variant="bodyM" color={colors.sub}>体重</T>
          {/* Health Connect から取り込んだ値（色だけでなく札の形で出す） */}
          {day.imported?.includes('weightKg') && <View testID="imported-weightKg"><Badge label="取り込み" tone="neutral" /></View>}
        </View>
        <Button label="入力・編集" icon="pencil" variant="text" small onPress={onEdit} testID="body-edit" style={{ marginRight: -12, paddingLeft: 12, paddingRight: 12 }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }} testID="body-weight">
        <RollNumber num bold size={64} value={w == null ? '—' : fmt1(kgToUnit(w, unit))} />
        {w != null && <T variant="bodyL" color={colors.sub}>{unit}</T>}
      </View>
      {summary !== '' && <T variant="bodyM" color={colors.sub} testID="body-summary">{summary}</T>}
      <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.m }}>
        {tiles.map((t) => (
          <PressableScale
            key={t.label} accessibilityRole="button"
            accessibilityLabel={`${t.label} ${t.value === '—' ? 'なし' : `${t.value}${t.unit}`}${t.hint ? `（${t.hint}）` : ''}。${t.label}の推移を見る`}
            onPress={() => openTrend(t.metric)} style={s.tile}
          >
            <T variant="bodyS" color={colors.sub} numberOfLines={1}>{t.label}</T>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }}>
              <T variant="numM" bold>{t.value}</T>
              {t.unit !== '' && <T variant="labelS" bold={false} color={colors.sub}>{t.unit}</T>}
            </View>
          </PressableScale>
        ))}
      </View>
      {heightCm == null && <T variant="bodyS" color={colors.sub} style={{ marginTop: space.s }}>BMI は、設定で身長を入れると出ます</T>}
      {day.memo !== '' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.m }}>
          <Icon name="pencil" size={20} color={colors.sub} />
          <T variant="bodyM" color={colors.sub} numberOfLines={1} style={{ flex: 1 }}>{day.memo}</T>
        </View>
      )}
    </Card>
  );
}

/** 睡眠・心拍・歩数の行（高さ 64、右に ›）。押すとそれぞれの推移へ */
function HealthRow({ testID, icon, title, sub, lead, value, unit, label, onPress, line }: {
  testID: string; icon: IconName; title: string; sub: string; lead?: string; value: string; unit: string; label: string; onPress: () => void; line?: boolean;
}) {
  return (
    <PressableScale testID={testID} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.98} onPress={onPress} style={[s.healthRow, line && s.line]}>
      <Icon name={icon} size={24} color={colors.sub} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="bodyL">{title}</T>
        <T variant="bodyS" color={colors.sub} numberOfLines={1}>{sub}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }}>
        {lead && <T variant="bodyS" color={colors.sub}>{lead}</T>}
        <T variant="numM" bold>{value}</T>
        {unit !== '' && <T variant="bodyS" color={colors.sub}>{unit}</T>}
      </View>
      <Icon name="chevron" size={24} color={colors.sub} />
    </PressableScale>
  );
}

const s = StyleSheet.create({
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingHorizontal: space.l, minHeight: 64, paddingVertical: space.s },
  tile: { flex: 1, minWidth: 0, minHeight: 64, backgroundColor: colors.input, borderRadius: radius.m, paddingHorizontal: space.m, paddingVertical: space.s, justifyContent: 'center' },
});
