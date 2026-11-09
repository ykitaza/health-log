import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LineChart } from '@/components/charts';
import { Icon, IconName } from '@/components/Icon';
import { Input } from '@/components/Input';
import { LoadError } from '@/components/LoadError';
import { PressableScale, RollNumber, Shake } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Card, IconButton, SectionTitle, TabHeader } from '@/components/ui';
import { useBackToToday } from '@/hooks/backToToday';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { BodyMetric, bmi, fatMass, leanMass, muscleMass, weightOverview } from '@/lib/body';
import { dateLabels, datePoints } from '@/lib/chart';
import { addDays, formatJpDate, todayKey } from '@/lib/date';
import { formatSigned } from '@/lib/format';
import { formatClock, formatHeartRate, formatHM, formatMinutes } from '@/lib/health';
import { Limit, LIMITS, MEMO_MAX_LENGTH, memoLengthError, parseInRange } from '@/lib/limits';
import { fmt1, kgToUnit, trimNumber } from '@/lib/units';
import { colors, fonts, radius, space } from '@/theme';

type Field = 'weightKg' | 'bodyFatPct' | 'musclePct' | 'waistCm';
const FIELDS: { key: Field; label: string; unit: string; metric: BodyMetric; weight?: boolean }[] = [
  { key: 'weightKg', label: '体重', unit: 'kg', metric: 'weight', weight: true },
  { key: 'bodyFatPct', label: '体脂肪率', unit: '%', metric: 'bodyFat' },
  { key: 'musclePct', label: '筋肉率', unit: '%', metric: 'muscle' },
  { key: 'waistCm', label: 'ウエスト', unit: 'cm', metric: 'waist' },
];
type Texts = Record<Field | 'memo', string>;
const FIELD_LIMITS: Record<Field, Limit> = {
  weightKg: LIMITS.bodyWeight, bodyFatPct: LIMITS.bodyFat, musclePct: LIMITS.muscle, waistCm: LIMITS.waist,
};

/** からだのタブ：体組成（日付ごとの入力、自動の計算、目標体重、体重の推移）と、取り込んだ睡眠・心拍 */
export default function BodyScreen() {
  const [date, setDate] = useState(todayKey);
  const { data, error: loadError, reload, repos } = useFocusData(async (r) => {
    const [daily, settings, sleep, heart] = await Promise.all([
      r.body.listDaily(), r.settings.get(), r.health.sleepDay(date), r.health.heartRateDay(date),
    ]);
    return { daily, settings, sleep, heart };
  }, date);
  const unit = data?.settings.weightUnit ?? 'kg';
  const day = data?.daily.find((d) => d.date === date) ?? null;
  const [texts, setTexts] = useState<Texts>({ weightKg: '', bodyFatPct: '', musclePct: '', waistCm: '', memo: '' });
  const [error, setError] = useState<string | null>(null);
  // 間違いのある欄と、間違えた回数（そのたびに欄を揺らす）
  const [bad, setBad] = useState<{ field: Field; count: number } | null>(null);
  // 打ったが、まだ保存していない欄。Android では、入力中に「前の日」「次の日」を押しても欄を離れない（onBlur が起きない）ため、
  // 日を変える前に、これを元の日に保存する
  const editing = useRef(new Set<keyof Texts>());

  // その日の保存済みの値を、欄に出す文字にしたもの
  const savedTexts = useMemo((): Texts => {
    const v = (n: number | null | undefined, conv = (x: number) => x) => (n == null ? '' : trimNumber(conv(n)));
    return {
      weightKg: v(day?.weightKg, (x) => kgToUnit(x, unit)),
      bodyFatPct: v(day?.bodyFatPct), musclePct: v(day?.musclePct), waistCm: v(day?.waistCm), memo: day?.memo ?? '',
    };
  }, [day, unit]);
  // 前に欄へ出した値（日付・単位と組で）
  const shown = useRef<{ date: string; unit: string; texts: Texts } | null>(null);
  useEffect(() => {
    const prev = shown.current;
    shown.current = { date, unit, texts: savedTexts };
    // 日付・単位を変えたときは、すべての欄を埋め直す
    if (!prev || prev.date !== date || prev.unit !== unit) {
      editing.current.clear();
      setTexts(savedTexts);
      setError(null);
      setBad(null);
      return;
    }
    // 読み直したとき（保存のあとなど）は、手で変えていない欄（前に出した値のまま）だけを、保存済みの値にそろえる。
    // 入力中の欄は消さない。保存が終わる前に日を移って戻ると、古いデータで埋めた欄が空のまま残り、触れて離れると値を消していた
    // 読み直しても値が同じなら、欄はそのまま（描き直さない）
    setTexts((x) => {
      const next = { ...x };
      for (const k of Object.keys(next) as (keyof Texts)[]) if (x[k] === prev.texts[k]) next[k] = savedTexts[k];
      return (Object.keys(next) as (keyof Texts)[]).every((k) => next[k] === x[k]) ? x : next;
    });
  }, [date, unit, savedTexts]);

  const commit = async (f: Field) => {
    editing.current.delete(f);
    const t = texts[f];
    // 出した値のままなら保存しない（lb で出した体重を kg に戻すと、丸めで値が変わるため）
    const saved = day?.[f];
    if (t.trim() === (saved == null ? '' : trimNumber(f === 'weightKg' ? kgToUnit(saved, unit) : saved))) { setError(null); setBad(null); return; }
    const parsed = parseInRange(t, FIELD_LIMITS[f], unit);
    if ('error' in parsed) { setError(parsed.error); setBad((b) => ({ field: f, count: (b?.count ?? 0) + 1 })); return; }
    setError(null);
    setBad(null);
    const value = parsed.value;
    if (value === (day?.[f] ?? null)) return;
    await repos.body.saveManual(date, { [f]: value });
    reload();
  };
  // 手入力の値と、その項目の取り込み（Health Connect）の行を消す（消した取り込みは、取り込み直しても戻らない）
  const clear = async (f: Field) => {
    setTexts((x) => ({ ...x, [f]: '' }));
    await repos.body.clearField(date, f);
    reload();
  };
  const commitMemo = async () => {
    editing.current.delete('memo');
    if (texts.memo.trim() === (day?.memo ?? '')) return;
    const tooLong = memoLengthError(texts.memo);
    if (tooLong) { setError(tooLong); return; }
    setError(null);
    await repos.body.saveManual(date, { memo: texts.memo.trim() });
    reload();
  };
  // 日を変える。保存していない欄は、先に今の日へ保存する（保存は順に行うので、日を変えたあとに終わっても元の日に入る）
  const changeDate = (next: string) => {
    for (const k of [...editing.current]) {
      if (k === 'memo') commitMemo();
      else commit(k);
    }
    setDate(next);
  };
  // 日をまたいだら、今日を見ていたなら新しい今日へ移す（前の日に記録を足さないように）。保存していない欄は元の日に保存する
  const today = useToday((next, prev) => { if (date === prev) changeDate(next); });
  // 前の日を見ているときは、Android の戻るでまず今日に戻す（保存していない欄は元の日に保存する）
  useBackToToday(date === today, () => changeDate(today));
  // ホームの体調のカードから、その日を指定して開いたとき
  const { date: asked } = useLocalSearchParams<{ date?: string }>();
  const changeRef = useRef(changeDate);
  useEffect(() => { changeRef.current = changeDate; });
  useEffect(() => { if (asked && asked <= todayKey()) changeRef.current(asked); }, [asked]);

  const height = data?.settings.heightCm ?? null;
  const w = day?.weightKg ?? null;
  const computed: { label: string; value: number | null; unit: string; metric: BodyMetric; weight?: boolean }[] = [
    { label: 'BMI', value: bmi(w, height), unit: '', metric: 'bmi' },
    { label: '体脂肪量', value: fatMass(w, day?.bodyFatPct ?? null), unit, metric: 'fatMass', weight: true },
    { label: '除脂肪体重', value: leanMass(w, day?.bodyFatPct ?? null), unit, metric: 'leanMass', weight: true },
    { label: '筋肉量', value: muscleMass(w, day?.musclePct ?? null), unit, metric: 'muscleMass', weight: true },
  ];

  // 体重の推移（1か月）と目標
  const goal = data?.settings.goalWeightKg ?? null;
  const { from, recent, pace, progress, monthChange } = weightOverview(data?.daily ?? [], goal, today);
  const openTrend = (metric: BodyMetric) => router.push({ pathname: '/body-trend', params: { metric } });

  if (loadError) return <Screen tab><LoadError onRetry={reload} /></Screen>;

  return (
    <Screen tab>
      <TabHeader title="からだ" />
      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 4 }}>
        <IconButton name="prev" label="前の日" onPress={() => changeDate(addDays(date, -1))} />
        <T variant="titleM">{formatJpDate(date)}</T>
        <IconButton name="next" label="次の日" disabled={date >= today} onPress={() => date < today && changeDate(addDays(date, 1))} />
      </Card>

      <Card style={{ marginTop: 12, padding: 0 }}>
        {FIELDS.map((f, i) => (
          <View key={f.key} style={[s.fieldRow, i > 0 && s.line]}>
            <View style={{ flex: 1, gap: space.xs }}>
              <T variant="bodyL">{f.label}</T>
              {day?.imported?.includes(f.key) && texts[f.key] === savedTexts[f.key] && (
                // Health Connect から取り込んだ値（色だけでなく札の形で出す）
                <View testID={`imported-${f.key}`}><Badge label="取り込み" tone="neutral" /></View>
              )}
            </View>
            {/* 値の欄（枠 3.7:1。入れられる所だと分かるように） */}
            <Shake trigger={bad?.field === f.key ? bad.count : 0} style={[s.valueBox, bad?.field === f.key && s.valueError]}>
              <Input
                value={texts[f.key]}
                onChangeText={(t) => { editing.current.add(f.key); setTexts((x) => ({ ...x, [f.key]: t })); }}
                onBlur={() => commit(f.key)}
                onSubmitEditing={() => commit(f.key)}
                keyboardType="decimal-pad"
                placeholder="—"
                accessibilityLabel={f.label}
                style={s.value}
              />
              <T variant="bodyM" color={colors.sub} style={{ width: 24 }}>{f.weight ? unit : f.unit}</T>
            </Shake>
            <IconButton name="close" label={`${f.label}を消す`} onPress={() => clear(f.key)} />
            <IconButton name="chart" label={`${f.label}の推移`} variant="selected" color={colors.accent} onPress={() => openTrend(f.metric)} />
          </View>
        ))}
        <View style={[s.fieldRow, s.line]}>
          <Icon name="pencil" size={24} color={colors.sub} />
          <Input
            value={texts.memo}
            onChangeText={(t) => { editing.current.add('memo'); setTexts((x) => ({ ...x, memo: t })); }}
            onBlur={commitMemo}
            maxLength={MEMO_MAX_LENGTH}
            placeholder="メモ（例：朝・起床後に計測）"
            accessibilityLabel="体組成のメモ"
            style={{ flex: 1, minWidth: 0, height: 48, color: colors.text, fontFamily: fonts.regular, fontSize: 16 }}
          />
        </View>
      </Card>
      {error && <T variant="bodyS" color={colors.danger} style={{ marginTop: space.s }}>{error}</T>}

      {/* 取り込んだ睡眠・心拍。押すとそれぞれの推移（記録がなければ、Health Connect をつなぐ導線） */}
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
      </Card>

      <SectionTitle title={`自動で計算${height != null ? `（身長 ${trimNumber(height)}cm）` : ''}`} />
      {height == null && <T variant="bodyS" color={colors.sub} style={{ marginBottom: space.s }}>BMI は、設定で身長を入れると出ます</T>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.m }}>
        {computed.map((c) => (
          <PressableScale key={c.label} accessibilityRole="button" accessibilityLabel={`${c.label}の推移`} onPress={() => openTrend(c.metric)} style={s.computed}>
            <View style={{ flex: 1 }}>
              <T variant="bodyS" color={colors.sub}>{c.label}</T>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }}>
                <RollNumber num bold size={22} value={c.value == null ? '—' : fmt1(c.weight ? kgToUnit(c.value, unit) : c.value)} ready={data != null} />
                <T variant="labelS" bold={false} color={colors.sub}>{c.unit}</T>
              </View>
            </View>
            <Icon name="chart" size={24} color={colors.sub} />
          </PressableScale>
        ))}
      </View>

      {progress && goal != null && (
        <Card style={{ marginTop: space.l }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T variant="titleM">目標体重まで</T>
            <T variant="bodyM" color={colors.sub}>目標 {fmt1(kgToUnit(goal, unit))}{unit}</T>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 }}>
            {progress.direction === 'reached' ? (
              <T variant="titleM" size={18} color={colors.accent}>目標に届きました</T>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <T variant="bodyM" color={colors.sub}>あと</T>
                <T variant="numL">{fmt1(kgToUnit(progress.remaining, unit))}</T>
                <T variant="bodyS" color={colors.sub}>{unit}</T>
              </View>
            )}
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              {progress.weeks != null && <Badge label={`このペースで約${progress.weeks}週`} />}
              <T variant="bodyS" color={colors.sub} align="right">
                {pace == null ? '直近28日の記録が2つ以上あるとペースが出ます' : `直近28日のペース ${formatSigned(kgToUnit(pace, unit))}${unit}／週`}
              </T>
            </View>
          </View>
        </Card>
      )}

      <PressableScale accessibilityRole="button" accessibilityLabel="体重の推移を見る" scaleTo={0.98} onPress={() => openTrend('weight')}>
        <Card style={{ marginTop: space.l }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.s }}>
            <T variant="titleM">体重の推移</T>
            {monthChange != null && (
              <T variant="labelL" color={colors.accent}>1か月で {formatSigned(kgToUnit(monthChange, unit))}{unit}</T>
            )}
          </View>
          {recent.length >= 2 ? (
            <LineChart
              points={datePoints(recent, (p) => kgToUnit(p.weightKg, unit), from, today)}
              xLabels={dateLabels(from, today, 3)}
              showYAxis={false}
              height={120}
            />
          ) : (
            <T variant="bodyM" color={colors.sub}>この1か月の体重の記録が2日以上になると、グラフが出ます</T>
          )}
        </Card>
      </PressableScale>
    </Screen>
  );
}

/** 睡眠・心拍の行（高さ 64、右に ›）。押すとそれぞれの推移へ */
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
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingLeft: space.l, paddingRight: space.s, minHeight: 72 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  valueBox: { flexDirection: 'row', alignItems: 'center', width: 128, height: 48, borderWidth: 1, borderColor: colors.outline, borderRadius: radius.input, paddingRight: space.s },
  value: { flex: 1, minWidth: 0, height: 46, color: colors.text, fontFamily: fonts.numBold, fontSize: 22, textAlign: 'right', paddingHorizontal: space.s },
  valueError: { borderColor: colors.danger, borderWidth: 2 },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingHorizontal: space.l, minHeight: 64, paddingVertical: space.s },
  computed: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.l, padding: space.l, minHeight: 72 },
});
