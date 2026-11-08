import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { LineChart } from '@/components/charts';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Card, IconButton } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { BodyMetric, bmi, fatMass, goalProgress, leanMass, muscleMass, weeklyPace } from '@/lib/body';
import { dateLabels, datePoints } from '@/lib/chart';
import { addDays, addMonths, formatJpDate, todayKey } from '@/lib/date';
import { Limit, LIMITS, parseInRange } from '@/lib/limits';
import { fmt1, kgToUnit, trimNumber } from '@/lib/units';
import { colors, fonts } from '@/theme';

type Field = 'weightKg' | 'bodyFatPct' | 'musclePct' | 'waistCm';
const FIELDS: { key: Field; label: string; unit: string; metric: BodyMetric; weight?: boolean }[] = [
  { key: 'weightKg', label: '体重', unit: 'kg', metric: 'weight', weight: true },
  { key: 'bodyFatPct', label: '体脂肪率', unit: '%', metric: 'bodyFat' },
  { key: 'musclePct', label: '筋肉率', unit: '%', metric: 'muscle' },
  { key: 'waistCm', label: 'ウエスト', unit: 'cm', metric: 'waist' },
];
const FIELD_LIMITS: Record<Field, Limit> = {
  weightKg: LIMITS.bodyWeight, bodyFatPct: LIMITS.bodyFat, musclePct: LIMITS.muscle, waistCm: LIMITS.waist,
};

/** 体組成（日付ごとの入力、自動の計算、目標体重、体重の推移） */
export default function BodyScreen() {
  const today = todayKey();
  const [date, setDate] = useState(today);
  const { data, reload, repos } = useFocusData(async (r) => {
    const [daily, settings] = await Promise.all([r.body.listDaily(), r.settings.get()]);
    return { daily, settings };
  });
  const unit = data?.settings.weightUnit ?? 'kg';
  const day = data?.daily.find((d) => d.date === date) ?? null;
  const [texts, setTexts] = useState<Record<Field | 'memo', string>>({ weightKg: '', bodyFatPct: '', musclePct: '', waistCm: '', memo: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const v = (n: number | null | undefined, conv = (x: number) => x) => (n == null ? '' : trimNumber(conv(n)));
    setTexts({
      weightKg: v(day?.weightKg, (x) => kgToUnit(x, unit)),
      bodyFatPct: v(day?.bodyFatPct), musclePct: v(day?.musclePct), waistCm: v(day?.waistCm), memo: day?.memo ?? '',
    });
    setError(null);
    // 日付・単位を変えたときと、読み込んだときだけ埋める（保存のたびに読み直しても、入力中の欄を消さない）
  }, [date, unit, data != null]);

  const commit = async (f: Field) => {
    const t = texts[f];
    // 出した値のままなら保存しない（lb で出した体重を kg に戻すと、丸めで値が変わるため）
    const saved = day?.[f];
    if (t.trim() === (saved == null ? '' : trimNumber(f === 'weightKg' ? kgToUnit(saved, unit) : saved))) { setError(null); return; }
    const parsed = parseInRange(t, FIELD_LIMITS[f], unit);
    if ('error' in parsed) { setError(parsed.error); return; }
    setError(null);
    const value = parsed.value;
    if (value === (day?.[f] ?? null)) return;
    await repos.body.saveManual(date, { [f]: value });
    reload();
  };
  const clear = async (f: Field) => {
    setTexts((x) => ({ ...x, [f]: '' }));
    await repos.body.saveManual(date, { [f]: null });
    reload();
  };
  const commitMemo = async () => {
    if (texts.memo.trim() === (day?.memo ?? '')) return;
    await repos.body.saveManual(date, { memo: texts.memo.trim() });
    reload();
  };

  const height = data?.settings.heightCm ?? null;
  const w = day?.weightKg ?? null;
  const computed: { label: string; value: number | null; unit: string; metric: BodyMetric; weight?: boolean }[] = [
    { label: 'BMI', value: bmi(w, height), unit: '', metric: 'bmi' },
    { label: '体脂肪量', value: fatMass(w, day?.bodyFatPct ?? null), unit, metric: 'fatMass', weight: true },
    { label: '除脂肪体重', value: leanMass(w, day?.bodyFatPct ?? null), unit, metric: 'leanMass', weight: true },
    { label: '筋肉量', value: muscleMass(w, day?.musclePct ?? null), unit, metric: 'muscleMass', weight: true },
  ];

  // 体重の推移（1か月）と目標
  const weights = (data?.daily ?? []).filter((d) => d.weightKg != null).map((d) => ({ date: d.date, weightKg: d.weightKg! }));
  const from = addMonths(today, -1);
  const recent = weights.filter((p) => p.date >= from && p.date <= today);
  const latest = weights.filter((p) => p.date <= today).at(-1);
  const goal = data?.settings.goalWeightKg ?? null;
  const pace = weeklyPace(weights, today);
  const progress = latest && goal != null ? goalProgress(latest.weightKg, goal, pace) : null;
  const monthChange = recent.length >= 2 ? recent[recent.length - 1].weightKg - recent[0].weightKg : null;
  const openTrend = (metric: BodyMetric) => router.push({ pathname: '/body-trend', params: { metric } });

  return (
    <Screen tab>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
        <T bold size={26}>体組成</T>
        <IconButton name="gear" label="設定" onPress={() => router.push('/settings')} />
      </View>
      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 4 }}>
        <IconButton name="prev" label="前の日" bg="transparent" onPress={() => setDate(addDays(date, -1))} />
        <T bold size={16}>{formatJpDate(date)}</T>
        <IconButton name="next" label="次の日" bg="transparent" color={date >= today ? colors.line : colors.text} onPress={() => date < today && setDate(addDays(date, 1))} />
      </Card>

      <Card style={{ marginTop: 12, padding: 0 }}>
        {FIELDS.map((f, i) => (
          <View key={f.key} style={[s.fieldRow, i > 0 && s.line]}>
            <T size={15} color={colors.sub} style={{ flex: 1 }}>{f.label}</T>
            <TextInput
              value={texts[f.key]}
              onChangeText={(t) => setTexts((x) => ({ ...x, [f.key]: t }))}
              onBlur={() => commit(f.key)}
              onSubmitEditing={() => commit(f.key)}
              keyboardType="decimal-pad"
              placeholder="—"
              placeholderTextColor={colors.sub}
              accessibilityLabel={f.label}
              style={s.value}
            />
            <T size={12} color={colors.sub} style={{ width: 22 }}>{f.weight ? unit : f.unit}</T>
            <IconButton name="close" label={`${f.label}を消す`} size={34} bg={colors.input} color={colors.sub} onPress={() => clear(f.key)} />
            <IconButton name="chart" label={`${f.label}の推移`} size={34} bg={colors.accentDark} color={colors.accent} onPress={() => openTrend(f.metric)} />
          </View>
        ))}
        <View style={[s.fieldRow, s.line]}>
          <Icon name="pencil" size={16} color={colors.sub} />
          <TextInput
            value={texts.memo}
            onChangeText={(t) => setTexts((x) => ({ ...x, memo: t }))}
            onBlur={commitMemo}
            placeholder="メモ（例：朝・起床後に計測）"
            placeholderTextColor={colors.sub}
            style={{ flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.regular, fontSize: 14 }}
          />
        </View>
      </Card>
      {error && <T size={12} color={colors.danger} style={{ marginTop: 6 }}>{error}</T>}

      <T bold size={13} color={colors.sub} style={{ marginTop: 18, marginBottom: 8 }}>
        自動で計算{height != null ? `（身長 ${trimNumber(height)}cm）` : ''}
      </T>
      {height == null && <T size={12} color={colors.sub} style={{ marginBottom: 8 }}>BMI は、設定で身長を入れると出ます</T>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {computed.map((c) => (
          <Pressable key={c.label} accessibilityRole="button" accessibilityLabel={`${c.label}の推移`} onPress={() => openTrend(c.metric)} style={s.computed}>
            <View style={{ flex: 1 }}>
              <T size={12} color={colors.sub}>{c.label}</T>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                <T num bold size={22}>{c.value == null ? '—' : fmt1(c.weight ? kgToUnit(c.value, unit) : c.value)}</T>
                <T size={11} color={colors.sub}>{c.unit}</T>
              </View>
            </View>
            <Icon name="chart" size={18} color={colors.sub} />
          </Pressable>
        ))}
      </View>

      {progress && goal != null && (
        <Card style={{ marginTop: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T bold size={16}>目標体重まで</T>
            <T size={13} color={colors.sub}>目標 {fmt1(kgToUnit(goal, unit))}{unit}</T>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 }}>
            {progress.direction === 'reached' ? (
              <T bold size={18} color={colors.accent}>目標に届きました</T>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <T size={13} color={colors.sub}>あと</T>
                <T num bold size={30}>{fmt1(kgToUnit(progress.remaining, unit))}</T>
                <T size={12} color={colors.sub}>{unit}</T>
              </View>
            )}
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              {progress.weeks != null && <Badge label={`このペースで約${progress.weeks}週`} />}
              <T size={11} color={colors.sub}>
                {pace == null ? '直近28日の記録が2つ以上あるとペースが出ます' : `直近28日のペース ${pace >= 0 ? '+' : '−'}${fmt1(Math.abs(kgToUnit(pace, unit)))}${unit}／週`}
              </T>
            </View>
          </View>
        </Card>
      )}

      <Pressable accessibilityRole="button" onPress={() => openTrend('weight')}>
        <Card style={{ marginTop: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <T bold size={16}>体重の推移</T>
            {monthChange != null && (
              <T bold size={13} color={colors.accent}>1か月で {monthChange >= 0 ? '+' : '−'}{fmt1(Math.abs(kgToUnit(monthChange, unit)))}{unit}</T>
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
            <T size={13} color={colors.sub}>この1か月の体重の記録が2日以上になると、グラフが出ます</T>
          )}
        </Card>
      </Pressable>
    </Screen>
  );
}

const s = StyleSheet.create({
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, minHeight: 60 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  value: { width: 90, height: 44, color: colors.text, fontFamily: fonts.numBold, fontSize: 26, textAlign: 'right' },
  computed: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 14 },
});
