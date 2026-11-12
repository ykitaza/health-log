import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BodyInputPatch, BodyInputSheet } from '@/components/BodyInputSheet';
import { BodyTrend } from '@/components/BodyTrend';
import { takeBodyInputRequest } from '@/components/home';
import { Icon, IconName } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { PressableScale, RollNumber } from '@/components/motion';
import { RecoveryInput, RecoveryMapCard } from '@/components/RecoveryMap';
import { DailyHighlights } from '@/components/reports';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Button, Card, IconButton, PrimaryTabs, TabHeader } from '@/components/ui';
import { useBackToToday } from '@/hooks/backToToday';
import { useFocusData } from '@/hooks/data';
import { useHealthConnect } from '@/hooks/healthConnect';
import { useToday } from '@/hooks/today';
import { BodyMetric, bmi, DailyBody, goalProgress, leanMass, previousWeight, weekAverage, weightUnitSpoken } from '@/lib/body';
import { addDays, formatJpDate, formatMonthDay, todayKey } from '@/lib/date';
import { formatClock, formatHeartRate, formatHM, formatMinutes, formatSteps, sevenDayAverage } from '@/lib/health';
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
    // その日の記録がない行に出す、その日までの7日の平均の材料（推移のタブの7日は今日まで）
    const dayFrom = addDays(date, -6);
    const [daily, settings, sleep, heart, steps, imported, sleepWeek, heartWeek, stepWeek, sleepUpTo, heartUpTo, stepUpTo, rows, parts, exercises, injuries] = await Promise.all([
      r.body.listDaily(), r.settings.get(), r.health.sleepDay(date), r.health.heartRateDay(date), r.health.stepDay(date), r.body.getImportedDay(date),
      r.health.sleepDays(from, today), r.health.heartRateDays(from, today), r.health.stepDays(from, today),
      r.health.sleepDays(dayFrom, date), r.health.heartRateDays(dayFrom, date), r.health.stepDays(dayFrom, date),
      // 回復マップ：筋トレのセット・部位・種目・ケガ
      r.workouts.allSetRows(), r.catalog.listBodyParts({ includeHidden: true }), r.catalog.listExercises({ includeHidden: true }), r.injuries.list(),
    ]);
    const nameById = new Map(parts.map((p) => [p.id, p.name]));
    const exPart = new Map(exercises.map((e) => [e.id, nameById.get(e.bodyPartId) ?? null]));
    const recovery: RecoveryInput = {
      rows, partName: (id) => nameById.get(id) ?? '', names: parts.filter((p) => !p.hidden).map((p) => p.name),
      partOfExercise: (id) => exPart.get(id) ?? null, injuries,
    };
    const avg = {
      sleep: sevenDayAverage(sleepUpTo.map((d) => ({ date: d.date, value: d.asleepMin })), date),
      restingBpm: sevenDayAverage(heartUpTo.filter((d) => d.restingBpm != null).map((d) => ({ date: d.date, value: d.restingBpm! })), date),
      steps: sevenDayAverage(stepUpTo.map((d) => ({ date: d.date, value: d.steps })), date),
    };
    return { date, daily, settings, sleep, heart, steps, imported, sleepWeek, heartWeek, stepWeek, avg, recovery };
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

  // その日の記録がない行の、その日までの7日の平均（前の日の値が残らないよう、読んだ日がいまの日のときだけ）
  const avg = data?.date === date ? data.avg : null;
  const sleepAvg = avg?.sleep ?? null;
  const restingDay = data?.heart?.restingBpm ?? null;
  const restingAvg = avg?.restingBpm ?? null;
  const stepsAvg = avg?.steps ?? null;

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

        {/* 取り込んだ睡眠・心拍・歩数。押すとそれぞれの推移（記録がなければ、Health Connect をつなぐ導線）。
            その日の記録がない行は、右にその日までの7日の平均を薄く（平均も出せなければ右は空） */}
        <Card style={{ marginTop: space.m, padding: 0 }}>
          <HealthRow
            testID="sleep-day"
            icon="moon"
            title="睡眠"
            sub={data?.sleep ? `${formatClock(data.sleep.mainStartAt)}〜${formatClock(data.sleep.mainEndAt)}${data.sleep.sessions > 1 ? `（ほか${data.sleep.sessions - 1}回）` : ''}` : 'この日の記録はありません'}
            value={data?.sleep ? formatHM(data.sleep.asleepMin) : sleepAvg != null ? formatHM(sleepAvg) : ''}
            unit={data?.sleep || sleepAvg != null ? '時間:分' : ''}
            lead={!data?.sleep && sleepAvg != null ? AVG_LEAD : undefined}
            faded={!data?.sleep}
            label={data?.sleep
              ? `睡眠 ${formatMinutes(data.sleep.asleepMin)}。睡眠の推移を見る`
              : `睡眠。この日の記録はありません。${sleepAvg != null ? `${AVG_LEAD} ${formatMinutes(Math.round(sleepAvg))}。` : ''}睡眠の推移を見る`}
            onPress={() => router.push({ pathname: '/health-trend', params: { kind: 'sleep' } })}
          />
          <HealthRow
            testID="heart-day"
            icon="heart"
            title="心拍"
            sub={data?.heart?.avgBpm != null ? formatHeartRate({ ...data.heart, restingBpm: null }).replace(' 拍/分', '') : 'この日の記録はありません'}
            lead={restingDay != null ? '安静時' : restingAvg != null ? AVG_LEAD : undefined}
            value={restingDay != null ? String(Math.round(restingDay)) : restingAvg != null ? String(Math.round(restingAvg)) : ''}
            unit={restingDay != null || restingAvg != null ? 'bpm' : ''}
            faded={restingDay == null}
            label={`${data?.heart ? `心拍 ${formatHeartRate(data.heart)}。` : '心拍。この日の記録はありません。'}${
              restingDay == null && restingAvg != null ? `安静時の${AVG_LEAD} ${Math.round(restingAvg)} 拍/分。` : ''}安静時心拍の推移を見る`}
            onPress={() => router.push({ pathname: '/health-trend', params: { kind: 'heart' } })}
            line
          />
          <HealthRow
            testID="steps-day"
            icon="steps"
            title="歩数"
            sub={data?.steps ? '1日の合計' : stepsBlocked ? '新しいアプリで許可すると取り込めます' : 'この日の記録はありません'}
            value={data?.steps ? formatSteps(data.steps.steps) : stepsAvg != null ? formatSteps(stepsAvg) : ''}
            unit={data?.steps || stepsAvg != null ? '歩' : ''}
            lead={!data?.steps && stepsAvg != null ? AVG_LEAD : undefined}
            faded={!data?.steps}
            label={data?.steps
              ? `歩数 1日の合計 ${formatSteps(data.steps.steps)} 歩。歩数の推移を見る`
              : `歩数。${stepsBlocked ? '新しいアプリを入れて歩数を許可すると取り込めます' : 'この日の記録はありません'}。${
                stepsAvg != null ? `${AVG_LEAD} ${formatSteps(stepsAvg)} 歩。` : ''}歩数の推移を見る`}
            onPress={() => router.push({ pathname: '/health-trend', params: { kind: 'steps' } })}
            line
          />
        </Card>

        {/* 回復マップ：その日までの記録で、部位ごとに最後に鍛えた日からの日数で光らせる（読んだ日がいまの日のときだけ）。
            その日の計測（体重・睡眠・心拍・歩数）をひと目で見られるよう、背の高い図はその下に置く */}
        {data?.date === date && <RecoveryMapCard input={data.recovery} date={date} />}
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
 * 記録がない日は、前回の記録の値を補足の色で（「前回・11月6日」の札、「この日はまだ計測していません」）と「計測を入れる」。
 * 前回の記録も一度もなければ、そう書き、「計測を入れる」だけ
 */
function WeightCard({ date, day, daily, unit, heightCm, goalKg, onEdit }: {
  date: string; day: DailyBody | null; daily: DailyBody[]; unit: WeightUnit; heightCm: number | null; goalKg: number | null; onEdit: () => void;
}) {
  const prev = day ? null : previousWeight(daily, date);
  const src = day ?? (prev ? daily.find((d) => d.date === prev.date) ?? null : null);
  if (!src) {
    return (
      <Card style={{ marginTop: space.m }}>
        <T variant="bodyM" color={colors.sub}>体重</T>
        <T variant="titleM" style={{ marginTop: space.xs }}>この日の記録はありません</T>
        <Button label="計測を入れる" icon="plus" variant="text" small onPress={onEdit} testID="body-add" style={{ alignSelf: 'flex-start', marginTop: space.s, marginLeft: -12, paddingLeft: 12 }} />
      </Card>
    );
  }
  // past：その日の記録がなく、前回の記録の値を出している（数字は補足の色。週の平均・目標・メモ・取り込みの印は出さない）
  const past = day == null;
  const valueColor = past ? colors.sub : undefined;
  const w = src.weightKg;
  const weights = daily.filter((d) => d.weightKg != null).map((d) => ({ date: d.date, value: d.weightKg! }));
  const week = past ? null : weekAverage(weights, date);
  const progress = !past && w != null && goalKg != null ? goalProgress(w, goalKg, null) : null;
  const summary = [
    week != null ? `週の平均 ${fmt1(kgToUnit(week, unit))} ${unit}` : null,
    progress ? (progress.direction === 'reached' ? '目標に届きました' : `目標まで あと ${fmt1(kgToUnit(progress.remaining, unit))} ${unit}`) : null,
  ].filter(Boolean).join(' ・ ');
  const lean = leanMass(w, src.bodyFatPct);
  const b = bmi(w, heightCm);
  const tiles: { label: string; value: string; unit: string; metric: BodyMetric; hint?: string }[] = [
    { label: '体脂肪率', value: src.bodyFatPct == null ? '—' : fmt1(src.bodyFatPct), unit: src.bodyFatPct == null ? '' : '%', metric: 'bodyFat' },
    { label: '除脂肪体重', value: lean == null ? '—' : fmt1(kgToUnit(lean, unit)), unit: lean == null ? '' : unit, metric: 'leanMass' },
    { label: 'BMI', value: b == null ? '—' : fmt1(b), unit: '', metric: 'bmi', hint: heightCm == null ? 'アカウントの画面で身長を入れると出ます' : undefined },
  ];
  const weightText = w == null ? '—' : fmt1(kgToUnit(w, unit));
  return (
    <Card style={{ marginTop: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -space.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <T variant="bodyM" color={colors.sub}>体重</T>
          {/* Health Connect から取り込んだ値（色だけでなく札の形で出す） */}
          {!past && day.imported?.includes('weightKg') && <View testID="imported-weightKg"><Badge label="取り込み" tone="neutral" /></View>}
          {past && <View testID="body-previous"><Badge label={`前回・${formatMonthDay(src.date)}`} tone="neutral" /></View>}
        </View>
        {past
          ? <Button label="計測を入れる" icon="plus" variant="text" small onPress={onEdit} testID="body-add" style={{ marginRight: -12, paddingLeft: 12, paddingRight: 12 }} />
          : <Button label="入力・編集" icon="pencil" variant="text" small onPress={onEdit} testID="body-edit" style={{ marginRight: -12, paddingLeft: 12, paddingRight: 12 }} />}
      </View>
      <View
        style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }} testID="body-weight"
        accessible={past} accessibilityLabel={past && w != null ? `この日の記録はありません。前回は ${formatMonthDay(src.date)}の ${weightText} ${weightUnitSpoken(unit)}` : undefined}
      >
        <RollNumber num bold size={64} color={valueColor} value={weightText} />
        {w != null && <T variant="bodyL" color={colors.sub}>{unit}</T>}
      </View>
      {past
        ? <T variant="bodyM" color={colors.sub} testID="body-summary">この日はまだ計測していません</T>
        : summary !== '' && <T variant="bodyM" color={colors.sub} testID="body-summary">{summary}</T>}
      <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.m }}>
        {tiles.map((t) => (
          <PressableScale
            key={t.label} accessibilityRole="button"
            accessibilityLabel={`${t.label} ${t.value === '—' ? 'なし' : `${past ? '前回 ' : ''}${t.value}${t.unit}`}${t.hint ? `（${t.hint}）` : ''}。${t.label}の推移を見る`}
            onPress={() => openTrend(t.metric)} style={s.tile}
          >
            <T variant="bodyS" color={colors.sub} numberOfLines={1}>{t.label}</T>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }}>
              <T variant="numM" bold color={valueColor}>{t.value}</T>
              {t.unit !== '' && <T variant="labelS" bold={false} color={colors.sub}>{t.unit}</T>}
            </View>
          </PressableScale>
        ))}
      </View>
      {heightCm == null && <T variant="bodyS" color={colors.sub} style={{ marginTop: space.s }}>BMI は、アカウントの画面で身長を入れると出ます</T>}
      {!past && day.memo !== '' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.m }}>
          <Icon name="pencil" size={20} color={colors.sub} />
          <T variant="bodyM" color={colors.sub} numberOfLines={1} style={{ flex: 1 }}>{day.memo}</T>
        </View>
      )}
    </Card>
  );
}

/** その日の記録がない行の、右の数字の前の言葉 */
const AVG_LEAD = '7日の平均';

/** 睡眠・心拍・歩数の行（高さ 64、右に ›）。押すとそれぞれの推移へ。faded はその日の値ではない（7日の平均）ので、数字を補足の色で。value が空なら右は出さない */
function HealthRow({ testID, icon, title, sub, lead, value, unit, label, onPress, line, faded }: {
  testID: string; icon: IconName; title: string; sub: string; lead?: string; value: string; unit: string; label: string; onPress: () => void; line?: boolean; faded?: boolean;
}) {
  return (
    <PressableScale testID={testID} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.98} onPress={onPress} style={[s.healthRow, line && s.line]}>
      <Icon name={icon} size={24} color={colors.sub} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="bodyL">{title}</T>
        <T variant="bodyS" color={colors.sub} numberOfLines={1}>{sub}</T>
      </View>
      {value !== '' && (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }}>
          {lead && <T variant="bodyS" color={colors.sub}>{lead}</T>}
          <T variant="numM" bold color={faded ? colors.sub : undefined}>{value}</T>
          {unit !== '' && <T variant="bodyS" color={colors.sub}>{unit}</T>}
        </View>
      )}
      <Icon name="chevron" size={24} color={colors.sub} />
    </PressableScale>
  );
}

const s = StyleSheet.create({
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingHorizontal: space.l, minHeight: 64, paddingVertical: space.s },
  tile: { flex: 1, minWidth: 0, minHeight: 64, backgroundColor: colors.input, borderRadius: radius.m, paddingHorizontal: space.m, paddingVertical: space.s, justifyContent: 'center' },
});
