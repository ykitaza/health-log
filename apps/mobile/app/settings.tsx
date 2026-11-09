import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { Input } from '@/components/Input';
import { Shake } from '@/components/motion';
import { LoadError } from '@/components/LoadError';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Card, Chip, Header, ListRow, Segmented, SectionTitle } from '@/components/ui';
import { useAuth } from '@/hooks/auth';
import { useFocusData } from '@/hooks/data';
import { versionLines } from '@/lib/appVersion';
import { workoutCsv } from '@/lib/csv';
import { LIMITS, parseInRange } from '@/lib/limits';
import { kgToUnit, trimNumber, WeightUnit } from '@/lib/units';
import { colors, fonts, radius, space } from '@/theme';

export default function SettingsScreen() {
  const { data: settings, error, reload, repos } = useFocusData((r) => r.settings.get());
  const { status: authStatus } = useAuth();
  const [height, setHeight] = useState('');
  const [goal, setGoal] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  // 間違いのある欄と、間違えた回数（そのたびに欄を揺らす）
  const [bad, setBad] = useState<{ field: 'height' | 'goal'; count: number } | null>(null);
  const fail = (field: 'height' | 'goal', error: string) => { setMessage(error); setBad((b) => ({ field, count: (b?.count ?? 0) + 1 })); };
  const ok = () => { setMessage(null); setBad(null); };
  const [exportError, setExportError] = useState<string | null>(null);
  // 打ったが、まだ保存していない欄。Android では、入力中に単位を押しても欄を離れない（onBlur が起きない）ため、
  // 単位を変える前に、これを今の単位で保存する
  const editing = useRef(new Set<'height' | 'goal'>());

  const unit = settings?.weightUnit ?? 'kg';
  // 入力欄は、読み込んだときと単位を変えたときだけ保存済みの値で埋める（入力中の値を消さない）
  const shownUnit = useRef<WeightUnit | null>(null);
  useEffect(() => {
    if (!settings || shownUnit.current === settings.weightUnit) return;
    shownUnit.current = settings.weightUnit;
    setHeight(settings.heightCm == null ? '' : trimNumber(settings.heightCm));
    setGoal(settings.goalWeightKg == null ? '' : trimNumber(kgToUnit(settings.goalWeightKg, settings.weightUnit)));
  }, [settings]);

  const save = async (patch: Parameters<typeof repos.settings.update>[0]) => { await repos.settings.update(patch); reload(); };

  const saveHeight = () => {
    editing.current.delete('height');
    const parsed = parseInRange(height, LIMITS.height);
    if ('error' in parsed) { fail('height', parsed.error); return; }
    ok();
    save({ heightCm: parsed.value });
  };
  const saveGoal = () => {
    editing.current.delete('goal');
    // 出した値のままなら保存しない（lb で出した目標体重を kg に戻すと、丸めで値が変わるため）
    const saved = settings?.goalWeightKg;
    if (goal.trim() === (saved == null ? '' : trimNumber(kgToUnit(saved, unit)))) { ok(); return; }
    const parsed = parseInRange(goal, LIMITS.goalWeight, unit);
    if ('error' in parsed) { fail('goal', parsed.error); return; }
    ok();
    save({ goalWeightKg: parsed.value });
  };

  const changeUnit = (u: WeightUnit) => {
    if (editing.current.has('height')) saveHeight();
    if (editing.current.has('goal')) saveGoal();
    save({ weightUnit: u });
  };

  const exportCsv = async () => {
    setExportError(null);
    const csv = workoutCsv(await repos.workouts.exportRows());
    try {
      await Share.share({ title: 'hlog の記録（CSV）', message: csv });
    } catch (e) {
      // 共有のメニューを自分で閉じただけ（web の AbortError）なら知らせない
      if ((e as { name?: string } | null)?.name === 'AbortError') return;
      setExportError('共有のメニューを開けなかったため、CSV を書き出せませんでした。');
    }
  };

  if (error) return <Screen><Header title="設定" onBack={() => router.back()} /><LoadError onRetry={reload} /></Screen>;

  return (
    <Screen>
      <Header title="設定" onBack={() => router.back()} />

      <SectionTitle title="アカウント" accent />
      <Card style={{ padding: 0 }}>
        <ListRow
          first
          title="ログイン"
          subtitle={authStatus === 'signedIn' ? 'ログインしています' : 'ログインしていません（任意）'}
          right={authStatus === 'signedIn' ? <Badge label="ログイン中" /> : undefined}
          onPress={() => router.push('/account')}
        />
        <ListRow title="Health Connect" subtitle="体重計・睡眠・心拍の取り込み（Android）" onPress={() => router.push('/health-connect')} />
        <ListRow title="チャットとの連携" subtitle="Claude・ChatGPT のつなぎ方と、開くボタン" onPress={() => router.push('/chat')} />
      </Card>

      {/* 筋トレ：記録の初期値と種目。食事：目標（前は「種目」の区分けに食事の目標が入っていた） */}
      <SectionTitle title="筋トレ" accent />
      <Card style={{ gap: space.l }}>
        <View style={{ gap: space.s }}>
          <T variant="titleM">重さの単位</T>
          <Segmented<WeightUnit> options={[{ key: 'kg', label: 'kg' }, { key: 'lb', label: 'lb' }]} value={unit} onChange={changeUnit} />
        </View>
        <View style={{ gap: space.xs }}>
          <T variant="titleM">セット数の初期値</T>
          <T variant="bodyM" color={colors.sub}>種目を追加したときに用意するセット数</T>
          <View style={{ flexDirection: 'row', columnGap: space.s, flexWrap: 'wrap' }}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <Chip key={n} label={`${n}セット`} active={settings?.defaultSetCount === n} onPress={() => save({ defaultSetCount: n })} />
            ))}
          </View>
        </View>
      </Card>
      <Card style={{ padding: 0, marginTop: space.m }}>
        <ListRow first title="種目と部位の管理" subtitle="追加・非表示" onPress={() => router.push('/exercises/manage')} />
      </Card>

      <SectionTitle title="食事" accent />
      <Card style={{ padding: 0 }}>
        <ListRow first title="食事の目標" subtitle="kcal と PFC、筋トレの日と休みの日" onPress={() => router.push('/meals/goal')} />
      </Card>

      <SectionTitle title="体の情報" accent />
      <Card style={{ gap: space.l }}>
        <Field label="身長" unit="cm" shake={bad?.field === 'height' ? bad.count : 0} value={height} onChange={(t) => { editing.current.add('height'); setHeight(t); }} onDone={saveHeight} />
        <Field label="目標体重" unit={unit} shake={bad?.field === 'goal' ? bad.count : 0} value={goal} onChange={(t) => { editing.current.add('goal'); setGoal(t); }} onDone={saveGoal} />
        {message && <T variant="bodyS" color={colors.danger}>{message}</T>}
        <T variant="bodyS" color={colors.sub}>身長はからだの自動計算（BMI など）に、目標体重はからだの「目標体重まで」に使います。空にすると消えます。</T>
      </Card>

      <SectionTitle title="データ" accent />
      <Card style={{ padding: 0 }}>
        <ListRow first title="筋トレの記録を CSV で書き出す" subtitle="共有のメニューから、保存先やアプリを選びます" onPress={exportCsv} />
      </Card>
      {exportError && <T variant="bodyS" color={colors.danger} style={{ marginTop: space.s }}>{exportError}</T>}
      <T variant="bodyS" color={colors.sub} style={{ marginTop: space.s }}>
        {authStatus === 'signedIn'
          ? '記録はこの端末に保存し、サーバーと同期します。同期の様子はアカウントの画面で見られます。'
          : '記録はこの端末の中だけに保存されます。アプリを消すと記録も消えます。ログインすると、サーバーと同期します。'}
      </T>

      <AppVersion />
    </Screen>
  );
}

/** M3 の outlined text field（高さ 56、枠 3.7:1、ラベルは枠の上）。選んでいるときは緑の 2px、間違いは赤の 2px */
function Field({ label, unit, value, shake, onChange, onDone }: {
  label: string; unit: string; value: string; shake: number; onChange: (t: string) => void; onDone: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const tone = shake > 0 ? colors.danger : focused ? colors.accent : null;
  return (
    <Shake trigger={shake}>
      <View style={[s.field, tone != null && { borderColor: tone, borderWidth: 2 }]}>
        <Input
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); onDone(); }}
          onSubmitEditing={onDone}
          keyboardType="decimal-pad"
          placeholder="未設定"
          accessibilityLabel={label}
          style={s.fieldInput}
        />
        <T variant="bodyM" color={colors.sub}>{unit}</T>
        <View style={s.fieldLabel} pointerEvents="none">
          <T variant="bodyS" color={tone ?? colors.sub}>{label}</T>
        </View>
      </View>
    </Shake>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', height: 56, borderWidth: 1, borderColor: colors.outline, borderRadius: radius.input, paddingHorizontal: space.l, gap: space.s },
  fieldInput: { flex: 1, minWidth: 0, height: 52, color: colors.text, fontFamily: fonts.regular, fontSize: 16 },
  fieldLabel: { position: 'absolute', top: -9, left: 12, paddingHorizontal: 4, backgroundColor: colors.card },
});

/** アプリの版とアップデートの情報。長押しで共有のメニューに出す（不具合の報告用） */
function AppVersion() {
  const dev = __DEV__ || Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  const lines = versionLines({
    dev,
    appVersion: Constants.nativeApplicationVersion,
    buildVersion: Constants.nativeBuildVersion,
    fallbackVersion: Constants.expoConfig?.version,
    updateId: Updates.updateId,
    createdAt: Updates.createdAt,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    channel: Updates.channel,
    runtimeVersion: Updates.runtimeVersion,
  });
  const share = () => { Share.share({ message: lines.join('\n') }).catch(() => {}); };
  return (
    <Pressable onLongPress={share} accessibilityLabel="アプリのバージョン" accessibilityHint="長押しで共有" style={{ marginTop: 24, gap: 2, alignItems: 'center' }}>
      {lines.map((l) => <T key={l} variant="labelS" bold={false} color={colors.sub}>{l}</T>)}
    </Pressable>
  );
}
