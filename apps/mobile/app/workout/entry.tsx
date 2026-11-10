import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Big3Badge } from '@/components/ExerciseFields';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { CheckPop, ColorFade, PopIn, Shake, useListMotion } from '@/components/motion';
import { RestTimerBar, restTimer } from '@/components/RestTimer';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Button, Card, DayNote, Header, IconButton } from '@/components/ui';
import type { Exercise } from '@/db/repositories/catalog';
import type { Settings } from '@/db/repositories/settings';
import type { Entry } from '@/db/repositories/workouts';
import { useBusy } from '@/hooks/busy';
import { useConfirmDiscard } from '@/hooks/confirmDiscard';
import { useRepos } from '@/hooks/data';
import { formatJpDate, todayKey } from '@/lib/date';
import { big3Assignments, FORM_VIDEO_OPEN_FAILED, openFormVideo } from '@/lib/exercises';
import { formatSetShort } from '@/lib/format';
import { MEMO_MAX_LENGTH } from '@/lib/limits';
import { onFeedback } from '@/lib/feedback';
import { beatsBest, copyOf, draftFromSet, hasChanges, lastFilledSet, prepareSave, SetDraft, SetError } from '@/lib/sets';
import { personalBests, PersonalBest } from '@/lib/training';
import { kgToUnit, trimNumber } from '@/lib/units';
import { touchRoom } from '@/lib/touch';
import { colors, fonts, placeholderColor, radius } from '@/theme';

let keySeq = 0;
const newKey = () => `k${++keySeq}`;
const blank = (): SetDraft => ({ key: newKey(), weight: '', reps: '', memo: '', done: false });

type Loaded = {
  exercise: Exercise;
  entry: Entry | null;
  previous: Entry | null;
  best: PersonalBest | null;
  settings: Settings;
  position: number; // その日の何種目目か
  big3: boolean; // BIG3 に割り当てた種目か
};

/** 記録の入力（セットを組む） */
export default function EntryScreen() {
  const params = useLocalSearchParams<{ date?: string; exerciseId?: string; entryId?: string }>();
  const today = todayKey();
  const date = params.date ?? today;
  const isToday = date === today;
  const isFuture = date > today;
  const repos = useRepos();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [drafts, setDrafts] = useState<SetDraft[]>([]);
  const [initial, setInitial] = useState<SetDraft[]>([]); // 開いたときのセット（保存していない変更があるかを見る）
  const [errors, setErrors] = useState<Map<string, SetError>>(new Map());
  const [formError, setFormError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ draft: SetDraft; index: number } | null>(null);
  // フォームの動画を開けなかったときの案内（数秒で消す）
  const [openFailed, setOpenFailed] = useState(false);
  const openFailedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 保存を押して入力の間違いが見つかった回数（間違いのある欄を、そのたびに揺らす）
  const [shakes, setShakes] = useState(0);
  // 保存は1つずつ（続けて届いた2回目は止める。保存して戻るときは、戻る間も押せないまま）
  const { busy: saving, run } = useBusy();
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const entry = params.entryId ? await repos.workouts.getEntry(params.entryId) : null;
      const exerciseId = entry?.exerciseId ?? params.exerciseId;
      if (!exerciseId) return;
      const [exercise, previous, rows, settings, day, all] = await Promise.all([
        repos.catalog.getExercise(exerciseId),
        repos.workouts.previousEntry(exerciseId, date),
        repos.workouts.allSetRows(),
        repos.settings.get(),
        repos.workouts.getDay(date),
        repos.catalog.listExercises({ includeHidden: true }),
      ]);
      if (!alive || !exercise) return;
      const position = entry ? day.findIndex((d) => d.id === entry.id) + 1 : day.length + 1;
      const big3 = Object.values(big3Assignments(all)).includes(exerciseId);
      setLoaded({ exercise, entry, previous, best: personalBests(rows, date).get(exerciseId) ?? null, settings, position, big3 });
      const unit = settings.weightUnit;
      const start = entry
        ? entry.sets.map((s) => draftFromSet(s, unit, newKey()))
        : Array.from({ length: settings.defaultSetCount }, blank);
      setDrafts(start);
      setInitial(start);
    })();
    return () => { alive = false; };
  }, [repos, params.entryId, params.exerciseId, date]);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (openFailedTimer.current) clearTimeout(openFailedTimer.current);
  }, []);

  // 保存していない変更があれば、戻る前に確かめる（Figma の「入力をやめますか？」）
  const { dialog, allowLeave } = useConfirmDiscard(hasChanges(initial, drafts), 'まだ追加していないセットは保存されません。');
  const list = useListMotion(loaded != null);

  if (!loaded) return <Screen><Header title="" onBack={() => router.back()} /></Screen>;

  const { exercise, entry, previous, best, settings } = loaded;
  const unit = settings.weightUnit;
  const weighted = exercise.recordType === 'weight_reps';
  // 写すのは、重量か回数が入っている最後のセット。入っているセットがなければ押せない
  const copySource = lastFilledSet(drafts);

  const update = (key: string, patch: Partial<SetDraft>) => {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    if (errors.has(key)) {
      const next = new Map(errors);
      next.delete(key);
      setErrors(next);
    }
    setFormError(null);
  };

  const copyPrevious = () => {
    if (!previous) return;
    // 前回の値だけを写す（メモと完了は写さない）
    setDrafts(previous.sets.map((s) => copyOf(draftFromSet(s, unit, ''), newKey())));
    setErrors(new Map());
  };

  const remove = (index: number) => {
    const draft = drafts[index];
    setDrafts((ds) => ds.filter((_, i) => i !== index));
    setUndo({ draft, index });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  };

  const restore = () => {
    if (!undo) return;
    setDrafts((ds) => [...ds.slice(0, undo.index), undo.draft, ...ds.slice(undo.index)]);
    setUndo(null);
  };

  const save = () => run(async (stayBusy) => {
    if (isFuture) return;
    const { errors: errs, formError: message, sets } = prepareSave(drafts, exercise.recordType, unit);
    setErrors(errs);
    if (errs.size > 0) setShakes((n) => n + 1);
    if (message) { setFormError(message); return; }
    try {
      await repos.workouts.saveEntry({ id: entry?.id, date, exerciseId: exercise.id, sets });
      stayBusy();
      onFeedback('save');
      allowLeave();
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/workout', params: { date } });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  });

  const openForm = async () => {
    if (!exercise.formVideoUrl) return;
    const ok = await openFormVideo(exercise.formVideoUrl, (u) => Linking.openURL(u));
    setOpenFailed(!ok);
    if (openFailedTimer.current) clearTimeout(openFailedTimer.current);
    if (!ok) openFailedTimer.current = setTimeout(() => setOpenFailed(false), 6000);
  };

  const saveLabel = entry ? '変更を保存' : isToday ? '今日のトレーニングに追加' : 'この日のトレーニングに追加';

  return (
    <Screen
      footer={
        <>
          {openFailed && (
            // AI で記録の「開けなかったとき」と同じ snackbar（明るい地）
            <View style={s.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <T variant="bodyM" color={colors.card} style={{ flex: 1, paddingVertical: 12 }}>{FORM_VIDEO_OPEN_FAILED}</T>
            </View>
          )}
          <RestTimerBar />
          {undo && (
            // M3 の snackbar（明るい地、操作は緑の文字）
            <View style={s.banner}>
              <T variant="bodyM" color={colors.card} style={{ flex: 1 }}>セット{undo.index + 1}を削除しました</T>
              <Pressable accessibilityRole="button" onPress={restore} style={s.bannerAction}><T variant="labelL" color={colors.inverseAccent}>元に戻す</T></Pressable>
            </View>
          )}
          {formError && <T variant="bodyM" color={colors.danger} align="center">{formError}</T>}
          <Button label={saving ? '保存しています…' : saveLabel} icon="check" onPress={save} disabled={isFuture} busy={saving} />
        </>
      }
    >
      {dialog}
      <Header
        title={exercise.name}
        subtitle={`${exercise.bodyPartName} ・ ${isToday ? '今日' : formatJpDate(date)}の${loaded.position}種目目`}
        onBack={() => router.back()}
        badge={loaded.big3 ? <Big3Badge /> : undefined}
        right={exercise.formVideoUrl ? (
          <Button
            label="フォーム" icon="external" variant="text" small onPress={openForm}
            accessibilityLabel={`${exercise.name}のフォームの動画を開く（外のアプリ）`} style={{ paddingLeft: 12, paddingRight: 12 }}
          />
        ) : undefined}
      />
      <DayNote date={date} today={today} />

      <Card style={{ marginTop: 8, gap: 8 }}>
        {previous ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', ...touchRoom(14) }}>
              <T variant="bodyM" color={colors.sub}>前回 {formatJpDate(previous.date)}</T>
              <Button label="前回をコピー" icon="copy" variant="text" small onPress={copyPrevious} style={{ paddingLeft: 12, paddingRight: 12, marginRight: -12 }} />
            </View>
            <T variant="titleM" size={18}>{previous.sets.map((s) => formatSetShort(s.weightKg, s.reps, unit)).join(' ・ ')}</T>
          </>
        ) : (
          <T variant="bodyM" color={colors.sub}>前回の記録はありません</T>
        )}
        {best && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="star" size={18} color={colors.star} />
            <T variant="bodyM" color={colors.sub} style={{ flexShrink: 1 }}>
              自己ベスト 推定1RM {Math.round(kgToUnit(best.e1rm, unit))}{unit}（{formatSetShort(best.weightKg, best.reps, unit)}）
            </T>
          </View>
        )}
      </Card>

      <Card style={{ marginTop: 14, gap: 4 }}>
        <View style={s.headRow}>
          <T variant="labelM" color={colors.sub} style={{ width: 36 }} align="center" numberOfLines={1}>セット</T>
          {weighted && <T variant="labelM" color={colors.sub} style={{ flex: 1 }} align="center">重量（{unit}）</T>}
          <T variant="labelM" color={colors.sub} style={{ flex: 1 }} align="center">回数</T>
          <T variant="labelM" color={colors.sub} style={{ width: 48 }} align="center">完了</T>
        </View>
        {drafts.map((d, i) => {
          const err = errors.get(d.key);
          const ph = previous?.sets[i];
          const newBest = beatsBest(d, best, exercise.recordType, unit);
          return (
            <Animated.View key={d.key} entering={list.entering(i)} exiting={list.exiting} layout={list.layout} style={{ gap: 6, marginTop: 8 }}>
              <ColorFade on={d.done} from={colors.card} to={colors.accentDark} style={s.setRow}>
                <T variant="numM" bold style={{ width: 36 }} align="center" color={d.done ? colors.text : colors.sub}>{i + 1}</T>
                {weighted && (
                  <NumberInput
                    label={`セット${i + 1}の重量`}
                    value={d.weight}
                    placeholder={ph?.weightKg != null ? trimNumber(kgToUnit(ph.weightKg, unit)) : '重量'}
                    onChange={(t) => update(d.key, { weight: t })}
                    error={!!err?.weight}
                    shake={err?.weight ? shakes : 0}
                    decimal
                  />
                )}
                <NumberInput
                  label={`セット${i + 1}の回数`}
                  value={d.reps}
                  placeholder={ph ? String(ph.reps) : '回数'}
                  onChange={(t) => update(d.key, { reps: t })}
                  error={!!err?.reps}
                  shake={err?.reps ? shakes : 0}
                />
                <Pressable
                  accessibilityRole="checkbox"
                  aria-checked={d.done}
                  accessibilityLabel={`セット${i + 1}の完了`}
                  onPress={() => {
                    if (!d.done) {
                      onFeedback('complete');
                      // 今日のセットを完了にしたら休憩を数え始める（設定が「切」の 0 秒なら動かさない。過去の日を直すときは動かさない）
                      if (isToday) restTimer.start(settings.restTimerSeconds);
                    }
                    update(d.key, { done: !d.done });
                  }}
                  style={s.doneTouch}
                >
                  {/* 済＝塗り、まだ＝枠（色だけでなく形でも分かる） */}
                  <View style={[s.done, d.done ? { backgroundColor: colors.accent, borderColor: colors.accent } : { borderColor: colors.outline }]}>
                    <CheckPop done={d.done}>
                      <Icon name="check" size={24} color={d.done ? colors.onAccent : colors.sub} />
                    </CheckPop>
                  </View>
                </Pressable>
              </ColorFade>
              <PopIn show={newBest} onShow={() => onFeedback('personalBest')} style={{ marginLeft: 44, alignSelf: 'flex-start' }}>
                <Badge label="自己ベスト更新" tone="star" icon="star" />
              </PopIn>
              {(err?.weight || err?.reps || err?.memo) && (
                <T variant="bodyS" color={colors.danger} style={{ marginLeft: 44 }}>{[err.weight, err.reps, err.memo].filter(Boolean).join('・')}</T>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 44 }}>
                <View style={s.memo}>
                  <Icon name="pencil" size={20} color={colors.sub} />
                  <Input
                    value={d.memo}
                    onChangeText={(t) => update(d.key, { memo: t })}
                    maxLength={MEMO_MAX_LENGTH}
                    placeholder="メモを追加"
                    accessibilityLabel={`セット${i + 1}のメモ`}
                    style={{ flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.regular, fontSize: 14, minHeight: 48 }}
                  />
                </View>
                <IconButton name="close" label={`セット${i + 1}を削除`} bg="transparent" color={colors.sub} onPress={() => remove(i)} />
              </View>
            </Animated.View>
          );
        })}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          <Button label="セットを追加" icon="plus" variant="tonal" small style={{ flex: 1 }} onPress={() => setDrafts((ds) => [...ds, blank()])} />
          <Button
            label="上のセットをコピー"
            icon="copy"
            variant="tonal"
            small
            style={{ flex: 1 }}
            disabled={copySource == null}
            onPress={() => setDrafts((ds) => {
              const src = lastFilledSet(ds);
              return src ? [...ds, copyOf(src, newKey())] : ds;
            })}
          />
        </View>
      </Card>
    </Screen>
  );
}

function NumberInput({ value, placeholder, onChange, error, shake = 0, decimal, label }: {
  value: string; placeholder: string; onChange: (t: string) => void; error?: boolean; shake?: number; decimal?: boolean; label: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Shake trigger={shake} style={{ flex: 1, minWidth: 0 }}>
      <Input
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={placeholderColor}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        accessibilityLabel={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selectTextOnFocus
        style={[
          s.input,
          focused && { borderColor: colors.accent, borderWidth: 2 },
          error && { borderColor: colors.danger, borderWidth: 2 },
        ]}
      />
    </Shake>
  );
}

const s = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.m, padding: 4, marginHorizontal: -4 },
  // 重量・回数の欄（M3 の outlined text field を詰めたもの。高さ 48、枠 3.7:1、選んでいる欄は緑の 2px、間違いは赤の 2px）
  input: {
    width: '100%', height: 48, borderRadius: radius.input, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.outline,
    color: colors.text, fontFamily: fonts.num, fontSize: 18, textAlign: 'center',
  },
  doneTouch: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  done: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  // メモの欄（M3 の filled text field。高さ 48、下に線）
  memo: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.input, paddingHorizontal: 12,
    borderTopLeftRadius: radius.xs, borderTopRightRadius: radius.xs, borderBottomWidth: 1, borderBottomColor: colors.outline,
  },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, backgroundColor: colors.text, borderRadius: radius.xs, paddingLeft: 16, paddingRight: 4 },
  bannerAction: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 },
});
