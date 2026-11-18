import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router, useLocalSearchParams } from 'expo-router';
import * as Updates from 'expo-updates';
import { useRef, useState } from 'react';
import { DevSettings, LayoutChangeEvent, Platform, Pressable, ScrollViewInstance, Share, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { Avatar } from '@/components/Avatar';
import { LoadError } from '@/components/LoadError';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Card, Chip, ConfirmDialog, Header, ListRow, Segmented, SectionTitle, Snackbar } from '@/components/ui';
import { useAuth } from '@/hooks/auth';
import { useFocusData } from '@/hooks/data';
import { useProfile } from '@/hooks/profile';
import { useToday } from '@/hooks/today';
import { versionLines } from '@/lib/appVersion';
import { workoutCsv } from '@/lib/csv';
import { REST_TIMER_OPTIONS, WEEKLY_MEAL_OPTIONS, WEEKLY_SLEEP_OPTIONS, WEEKLY_TRAINING_OPTIONS } from '@/lib/goals';
import { WEEKLY_GOALS_SECTION } from '@/lib/home';
import { HeroPhase, heroPhase } from '@/lib/homeHero';
import { phaseLabel } from '@/lib/phases';
import { endedPhases } from '@/lib/phaseReview';
import { accountTitle } from '@/lib/profile';
import { fmt1, kgToUnit, WeightUnit } from '@/lib/units';
import { colors, look, space } from '@/theme';
import type { Look } from '@/theme/look';

export default function SettingsScreen() {
  const { data: settings, error, reload, repos } = useFocusData((r) => r.settings.get());
  const { status: authStatus } = useAuth();
  const today = useToday();
  // フェーズの行（いちばん上）：今のフェーズ・療養と、様子見のときの目標体重。終えたフェーズがあれば「これまでのフェーズ」
  const { data: phaseData } = useFocusData(async (r) => {
    const [phases, daily] = await Promise.all([r.phases.list(), r.body.listDaily()]);
    const weights = daily.flatMap((d) => (d.weightKg != null ? [{ date: d.date, kg: d.weightKg }] : []));
    return { hero: heroPhase(phases, weights, today), ended: endedPhases(phases).length };
  }, today);
  const phaseNow = phaseData?.hero;
  const profile = useProfile();
  const [exportError, setExportError] = useState<string | null>(null);
  // レポートの今週の目標（週のまとめの「目標を変える」、レポートのタブの今週の目標）から開いたとき（section=weekly-goals）は、今週の目標の欄までスクロールする（開いたときの1回だけ）
  const { section } = useLocalSearchParams<{ section?: string }>();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrolledToSection = useRef(false);
  const reduced = useReducedMotion();
  const onGoalsLayout = (e: LayoutChangeEvent) => {
    if (section !== WEEKLY_GOALS_SECTION || scrolledToSection.current) return;
    scrolledToSection.current = true;
    const { y } = e.nativeEvent.layout;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y, animated: !reduced }));
  };

  const unit = settings?.weightUnit ?? 'kg';
  const save = async (patch: Parameters<typeof repos.settings.update>[0]) => { await repos.settings.update(patch); reload(); };
  const changeUnit = (u: WeightUnit) => { save({ weightUnit: u }); };

  const exportCsv = async () => {
    setExportError(null);
    const csv = workoutCsv(await repos.workouts.exportRows());
    try {
      await Share.share({ title: 'KARADA の記録（CSV）', message: csv });
    } catch (e) {
      // 共有のメニューを自分で閉じただけ（web の AbortError）なら知らせない
      if ((e as { name?: string } | null)?.name === 'AbortError') return;
      setExportError('共有のメニューを開けなかったため、CSV を書き出せませんでした。');
    }
  };

  if (error) return <Screen><Header title="設定" onBack={() => router.back()} /><LoadError onRetry={reload} /></Screen>;

  return (
    <Screen scrollRef={scrollRef}>
      <Header title="設定" onBack={() => router.back()} />

      <SectionTitle title="フェーズ" />
      <Card style={{ padding: 0 }}>
        <ListRow
          first
          title="フェーズ"
          subtitle={phaseSubtitle(phaseNow ?? null, settings?.goalWeightKg ?? null, unit)}
          right={phaseNow?.kind === 'none' ? <T variant="labelL" color={colors.accent}>始める</T> : undefined}
          onPress={() => router.push(phaseNow == null || phaseNow.kind === 'none' ? '/phase/new' : '/phase')}
          testID="settings-phase"
        />
        {phaseData != null && phaseData.ended > 0 && (
          <ListRow title="これまでのフェーズ" subtitle={`終えたフェーズ ${phaseData.ended}件の振り返り`} onPress={() => router.push('/phase/history')} testID="settings-phase-history" />
        )}
      </Card>

      <SectionTitle title="アカウント" />
      <Card style={{ padding: 0 }}>
        {/* 表示名と写真（なければアプリのアイコン）。押すとアカウントの画面（体の情報・ログインと同期もそこ） */}
        <ListRow
          first
          left={<Avatar uri={profile.photoUri} size={40} />}
          title={accountTitle(profile.displayName)}
          subtitle={authStatus === 'signedIn' ? 'ログインしています' : 'ログインしていません（任意）'}
          right={authStatus === 'signedIn' ? <Badge label="ログイン中" /> : undefined}
          onPress={() => router.push('/account')}
          testID="settings-account"
        />
        <ListRow title="Health Connect" subtitle="体重・体脂肪率・睡眠・心拍・歩数の取り込み（Android）" onPress={() => router.push('/health-connect')} />
        <ListRow title="チャットとの連携" subtitle="Claude・ChatGPT のつなぎ方と、開くボタン" onPress={() => router.push('/chat')} />
      </Card>

      {/* 記録の初期値（重さの単位・セット数・休憩のタイマー）と今週の目標。種目の管理は「筋トレ」の節。体の情報はアカウントの画面 */}
      <SectionTitle title="記録の初期値" />
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
        <Choices
          title="休憩のタイマー" description="セットの完了から数え、時間になると振動します"
          options={REST_TIMER_OPTIONS} value={settings?.restTimerSeconds} label={(n) => (n === 0 ? '切' : `${n}秒`)}
          onChange={(restTimerSeconds) => save({ restTimerSeconds })}
        />
      </Card>

      <View onLayout={onGoalsLayout} testID="settings-weekly-goals">
        <SectionTitle title="今週の目標" />
        <Card style={{ gap: space.l }}>
          <Choices
            title="筋トレ" description="1週間に筋トレをする回数"
            options={WEEKLY_TRAINING_OPTIONS} value={settings?.weeklyGoalTrainingDays} label={(n) => `${n}回`}
            onChange={(weeklyGoalTrainingDays) => save({ weeklyGoalTrainingDays })}
          />
          <Choices
            title="食事の記録" description="1週間に食事を記録する日数"
            options={WEEKLY_MEAL_OPTIONS} value={settings?.weeklyGoalMealDays} label={(n) => `${n}日`}
            onChange={(weeklyGoalMealDays) => save({ weeklyGoalMealDays })}
          />
          <Choices
            title="睡眠" description="7時間以上寝る日数。Health Connect の睡眠で数えます"
            options={WEEKLY_SLEEP_OPTIONS} value={settings?.weeklyGoalSleepDays} label={(n) => (n === 0 ? '切' : `${n}日`)}
            onChange={(weeklyGoalSleepDays) => save({ weeklyGoalSleepDays })}
          />
        </Card>
      </View>

      <SectionTitle title="筋トレ" />
      <Card style={{ padding: 0 }}>
        <ListRow first title="種目と部位の管理" subtitle="追加・非表示" onPress={() => router.push('/exercises/manage')} />
      </Card>

      <SectionTitle title="食事" />
      <Card style={{ padding: 0 }}>
        <ListRow first title="食事の目標" subtitle="kcal と PFC、筋トレの日と休みの日" onPress={() => router.push('/meals/goal')} />
      </Card>

      <AppearanceSection />

      <SectionTitle title="データ" />
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

/** フェーズの行の補足：様子見中（目標体重）、実施中（名前と何週目）、療養中（何日目） */
function phaseSubtitle(h: HeroPhase | null, goalKg: number | null, unit: WeightUnit): string {
  if (h == null) return '';
  if (h.kind === 'none') return goalKg == null ? '様子見中' : `様子見中（目標体重 ${fmt1(kgToUnit(goalKg, unit))} ${unit}）`;
  if (h.kind === 'rehab') return `療養 ${h.rehabDays}日目${h.paused ? `・${phaseLabel(h.paused.phase)}は停止中` : ''}`;
  return `${phaseLabel(h.phase)}・${h.progress.week}／${h.progress.weeksTotal ?? h.progress.week}週目`;
}

const LOOK_OPTIONS: { key: Look; label: string }[] = [{ key: 'hud', label: 'HUD' }, { key: 'classic', label: 'クラシック' }];

/**
 * アプリを開き直す（見た目は theme が最初に評価されるときに読むため）。web は再読み込み、ネイティブは expo-updates。
 * 開発のビルドで expo-updates が使えないときは DevSettings で開き直す。開き直せなかったら false
 */
async function reloadApp(): Promise<boolean> {
  if (Platform.OS === 'web') {
    window.location.reload();
    return true;
  }
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    if (__DEV__) {
      DevSettings.reload();
      return true;
    }
    return false;
  }
}

/**
 * 表示：見た目（HUD・クラシック）の切り替え。選ぶと確かめてから保存し、アプリを開き直す。
 * 保存した値（ふつうの非同期の読み出し）と、今の表示（theme が起動のときに同期で読んだ値）が違うときは、そのことを小さく知らせる
 * （起動のときの読み出しが黙って失敗していても気づけるように）
 */
function AppearanceSection() {
  const { data: stored, repos } = useFocusData((r) => r.settings.appearance());
  const [asked, setAsked] = useState<Look | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const value = stored ?? look;
  const apply = async () => {
    if (!asked) return;
    setBusy(true);
    try {
      await repos.settings.setAppearance(asked);
      if (await reloadApp()) return;
      setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy(false);
    setAsked(null);
  };
  return (
    <>
      <SectionTitle title="表示" />
      <Card style={{ gap: space.s }}>
        <T variant="titleM">見た目</T>
        <T variant="bodyM" color={colors.sub}>選ぶとアプリを開き直して切り替えます</T>
        <Segmented<Look> options={LOOK_OPTIONS} value={value} onChange={(k) => { if (k !== value) setAsked(k); }} />
        {stored != null && stored !== look && (
          <T variant="bodyS" color={colors.sub} testID="appearance-mismatch">保存した見た目と表示が違います（開き直してください）</T>
        )}
        {failed && <Snackbar message="アプリを開き直すと切り替わります" testID="appearance-reload-notice" />}
      </Card>
      <ConfirmDialog
        visible={asked != null} title="見た目を切り替えますか？" body={asked ? `${LOOK_OPTIONS.find((o) => o.key === asked)!.label}にして、アプリを開き直します。` : undefined}
        confirmLabel="切り替える" danger={false} busy={busy} onConfirm={apply} onCancel={() => setAsked(null)}
      />
    </>
  );
}

/** 選択肢のチップ（セット数の初期値と同じ形）。読み上げは「休憩のタイマー、90秒」のように、何の選択肢かを足す */
function Choices({ title, description, options, value, label, onChange }: {
  title: string; description: string; options: readonly number[]; value: number | undefined;
  label: (n: number) => string; onChange: (n: number) => void;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <T variant="titleM">{title}</T>
      <T variant="bodyM" color={colors.sub}>{description}</T>
      <View style={{ flexDirection: 'row', columnGap: space.s, flexWrap: 'wrap' }}>
        {options.map((n) => (
          <Chip key={n} label={label(n)} accessibilityLabel={`${title}、${label(n)}`} active={value === n} onPress={() => onChange(n)} />
        ))}
      </View>
    </View>
  );
}

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
