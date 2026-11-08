import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Share, View } from 'react-native';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Card, Chip, Header, ListRow, Segmented, SectionTitle } from '@/components/ui';
import { useAuth } from '@/hooks/auth';
import { useFocusData } from '@/hooks/data';
import { toCsv } from '@/lib/csv';
import { LIMITS, parseInRange } from '@/lib/limits';
import { kgToUnit, trimNumber, WeightUnit } from '@/lib/units';
import { colors, fonts } from '@/theme';

export default function SettingsScreen() {
  const { data: settings, reload, repos } = useFocusData((r) => r.settings.get());
  const { status: authStatus } = useAuth();
  const [height, setHeight] = useState('');
  const [goal, setGoal] = useState('');
  const [message, setMessage] = useState<string | null>(null);
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
    if ('error' in parsed) { setMessage(parsed.error); return; }
    setMessage(null);
    save({ heightCm: parsed.value });
  };
  const saveGoal = () => {
    editing.current.delete('goal');
    // 出した値のままなら保存しない（lb で出した目標体重を kg に戻すと、丸めで値が変わるため）
    const saved = settings?.goalWeightKg;
    if (goal.trim() === (saved == null ? '' : trimNumber(kgToUnit(saved, unit)))) { setMessage(null); return; }
    const parsed = parseInRange(goal, LIMITS.goalWeight, unit);
    if ('error' in parsed) { setMessage(parsed.error); return; }
    setMessage(null);
    save({ goalWeightKg: parsed.value });
  };

  const changeUnit = (u: WeightUnit) => {
    if (editing.current.has('height')) saveHeight();
    if (editing.current.has('goal')) saveGoal();
    save({ weightUnit: u });
  };

  const exportCsv = async () => {
    setExportError(null);
    const rows = await repos.workouts.exportRows();
    const csv = toCsv(
      ['日付', '部位', '種目', 'セット', '重量(kg)', '回数', 'メモ', '完了'],
      rows.map((r) => [r.date, r.body_part, r.exercise, r.set_index + 1, r.weight_kg, r.reps, r.memo, r.done ? 1 : 0]),
    );
    try {
      await Share.share({ title: 'トレログの記録（CSV）', message: csv });
    } catch (e) {
      // 共有のメニューを自分で閉じただけ（web の AbortError）なら知らせない
      if ((e as { name?: string } | null)?.name === 'AbortError') return;
      setExportError('共有のメニューを開けなかったため、CSV を書き出せませんでした。');
    }
  };

  return (
    <Screen>
      <Header title="設定" onBack={() => router.back()} />

      <SectionTitle title="アカウント" />
      <Card style={{ padding: 0 }}>
        <ListRow
          first
          title="ログイン"
          subtitle={authStatus === 'signedIn' ? 'ログインしています' : 'ログインしていません（任意）'}
          right={authStatus === 'signedIn' ? <Badge label="ログイン中" /> : undefined}
          onPress={() => router.push('/account')}
        />
      </Card>

      <SectionTitle title="記録の初期値" />
      <Card style={{ gap: 14 }}>
        <View style={{ gap: 8 }}>
          <T bold size={16}>重さの単位</T>
          <Segmented<WeightUnit> options={[{ key: 'kg', label: 'kg' }, { key: 'lb', label: 'lb' }]} value={unit} onChange={changeUnit} />
        </View>
        <View style={{ gap: 8 }}>
          <T bold size={16}>セット数の初期値</T>
          <T size={12} color={colors.sub}>種目を追加したときに用意するセット数</T>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <Chip key={n} label={`${n}セット`} active={settings?.defaultSetCount === n} onPress={() => save({ defaultSetCount: n })} />
            ))}
          </View>
        </View>
      </Card>

      <SectionTitle title="体の情報" />
      <Card style={{ gap: 12 }}>
        <Field label="身長" unit="cm" value={height} onChange={(t) => { editing.current.add('height'); setHeight(t); }} onDone={saveHeight} />
        <Field label="目標体重" unit={unit} value={goal} onChange={(t) => { editing.current.add('goal'); setGoal(t); }} onDone={saveGoal} />
        {message && <T size={12} color={colors.danger}>{message}</T>}
        <T size={12} color={colors.sub}>身長は体組成の自動計算（BMI など）に、目標体重は体組成の「目標体重まで」に使います。空にすると消えます。</T>
      </Card>

      <SectionTitle title="種目" />
      <Card style={{ padding: 0 }}>
        <ListRow first title="種目と部位の管理" subtitle="追加・非表示" onPress={() => router.push('/exercises/manage')} />
      </Card>

      <SectionTitle title="データ" />
      <Card style={{ padding: 0 }}>
        <ListRow first title="筋トレの記録を CSV で書き出す" subtitle="共有のメニューから、保存先やアプリを選びます" onPress={exportCsv} />
      </Card>
      {exportError && <T size={12} color={colors.danger} style={{ marginTop: 8 }}>{exportError}</T>}
      <T size={12} color={colors.sub} style={{ marginTop: 8 }}>
        記録はこの端末の中だけに保存されます。アプリを消すと記録も消えます。
      </T>

      <SectionTitle title="次の段階で使えるようになるもの" />
      <Card style={{ padding: 0 }}>
        {['サーバーとの同期', '食事の目標', 'チャットとの連携'].map((t, i) => (
          <ListRow key={t} first={i === 0} title={t} dim right={<Badge label="準備中" color={colors.sub} bg={colors.input} />} />
        ))}
      </Card>
    </Screen>
  );
}

function Field({ label, unit, value, onChange, onDone }: { label: string; unit: string; value: string; onChange: (t: string) => void; onDone: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <T bold size={16} style={{ flex: 1 }}>{label}</T>
      <Input
        value={value}
        onChangeText={onChange}
        onBlur={onDone}
        onSubmitEditing={onDone}
        keyboardType="decimal-pad"
        placeholder="未設定"
        placeholderTextColor={colors.sub}
        accessibilityLabel={label}
        style={{ width: 110, height: 44, borderRadius: 10, backgroundColor: colors.input, color: colors.text, fontFamily: fonts.bold, fontSize: 16, textAlign: 'right', paddingHorizontal: 12 }}
      />
      <T size={13} color={colors.sub} style={{ width: 24 }}>{unit}</T>
    </View>
  );
}
