import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, DayNote, Header, IconButton } from '@/components/ui';
import type { Exercise } from '@/db/repositories/catalog';
import type { Settings } from '@/db/repositories/settings';
import type { Entry } from '@/db/repositories/workouts';
import { useConfirmDiscard } from '@/hooks/confirmDiscard';
import { useRepos } from '@/hooks/data';
import { formatJpDate, todayKey } from '@/lib/date';
import { formatSetShort } from '@/lib/format';
import { MEMO_MAX_LENGTH } from '@/lib/limits';
import { copyOf, hasChanges, lastFilledSet, SetDraft, SetError, toSetInputs, validateSets } from '@/lib/sets';
import { personalBests, PersonalBest } from '@/lib/training';
import { kgToUnit, trimNumber } from '@/lib/units';
import { colors, fonts } from '@/theme';

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
  const [saving, setSaving] = useState(false);
  // 保存の途中か。saving（ボタンを押せなくする）は描き直すまで効かないので、続けて届いた2回目はこれで止める
  const savingRef = useRef(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const entry = params.entryId ? await repos.workouts.getEntry(params.entryId) : null;
      const exerciseId = entry?.exerciseId ?? params.exerciseId;
      if (!exerciseId) return;
      const [exercise, previous, rows, settings, day] = await Promise.all([
        repos.catalog.getExercise(exerciseId),
        repos.workouts.previousEntry(exerciseId, date),
        repos.workouts.allSetRows(),
        repos.settings.get(),
        repos.workouts.getDay(date),
      ]);
      if (!alive || !exercise) return;
      const position = entry ? day.findIndex((d) => d.id === entry.id) + 1 : day.length + 1;
      setLoaded({ exercise, entry, previous, best: personalBests(rows, date).get(exerciseId) ?? null, settings, position });
      const unit = settings.weightUnit;
      const start = entry
        ? entry.sets.map((s) => ({
            key: newKey(), id: s.id, weight: s.weightKg == null ? '' : trimNumber(kgToUnit(s.weightKg, unit)),
            weightKg: s.weightKg ?? undefined, reps: String(s.reps), memo: s.memo, done: s.done,
          }))
        : Array.from({ length: settings.defaultSetCount }, blank);
      setDrafts(start);
      setInitial(start);
    })();
    return () => { alive = false; };
  }, [repos, params.entryId, params.exerciseId, date]);

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  // 保存していない変更があれば、戻る前に確かめる（Figma の「入力をやめますか？」）
  const { dialog, allowLeave } = useConfirmDiscard(hasChanges(initial, drafts), 'まだ追加していないセットは保存されません。');

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
    setDrafts(previous.sets.map((s) => ({
      key: newKey(), weight: s.weightKg == null ? '' : trimNumber(kgToUnit(s.weightKg, unit)), weightKg: s.weightKg ?? undefined,
      reps: String(s.reps), memo: '', done: false,
    })));
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

  const save = async () => {
    if (savingRef.current || isFuture) return;
    const errs = validateSets(drafts, exercise.recordType, unit);
    setErrors(errs);
    if (errs.size > 0) { setFormError('入力を確かめてください'); return; }
    const sets = toSetInputs(drafts, exercise.recordType, unit);
    if (sets.length === 0) { setFormError('セットを1つ以上入れてください'); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      await repos.workouts.saveEntry({ id: entry?.id, date, exerciseId: exercise.id, sets });
      allowLeave();
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/workout', params: { date } });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveLabel = entry ? '変更を保存' : isToday ? '今日のトレーニングに追加' : 'この日のトレーニングに追加';

  return (
    <Screen
      footer={
        <>
          {undo && (
            <View style={s.banner}>
              <T size={14}>セット{undo.index + 1}を削除しました</T>
              <Pressable accessibilityRole="button" onPress={restore} hitSlop={8}><T bold color={colors.accent}>元に戻す</T></Pressable>
            </View>
          )}
          {formError && <T size={13} color={colors.danger} align="center">{formError}</T>}
          <Button label={saveLabel} icon="check" onPress={save} disabled={saving || isFuture} />
        </>
      }
    >
      {dialog}
      <Header
        title={exercise.name}
        subtitle={`${exercise.bodyPartName} ・ ${isToday ? '今日' : formatJpDate(date)}の${loaded.position}種目目`}
        onBack={() => router.back()}
      />
      <DayNote date={date} today={today} />

      <Card style={{ marginTop: 8, gap: 8 }}>
        {previous ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T size={13} color={colors.sub}>前回 {formatJpDate(previous.date)}</T>
              <Pressable accessibilityRole="button" onPress={copyPrevious} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} hitSlop={8}>
                <Icon name="copy" size={16} color={colors.accent} />
                <T bold size={14} color={colors.accent}>前回をコピー</T>
              </Pressable>
            </View>
            <T num bold size={17}>{previous.sets.map((s) => formatSetShort(s.weightKg, s.reps, unit)).join(' ・ ')}</T>
          </>
        ) : (
          <T size={13} color={colors.sub}>前回の記録はありません</T>
        )}
        {best && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="star" size={15} color={colors.star} />
            <T size={12} color={colors.sub}>
              自己ベスト 推定1RM {Math.round(kgToUnit(best.e1rm, unit))}{unit}（{formatSetShort(best.weightKg, best.reps, unit)}）
            </T>
          </View>
        )}
      </Card>

      <Card style={{ marginTop: 14, gap: 4 }}>
        <View style={s.headRow}>
          <T size={10} color={colors.sub} style={{ width: 36 }} align="center" numberOfLines={1}>セット</T>
          {weighted && <T size={11} color={colors.sub} style={{ flex: 1 }} align="center">重量（{unit}）</T>}
          <T size={11} color={colors.sub} style={{ flex: 1 }} align="center">回数</T>
          <T size={11} color={colors.sub} style={{ width: 44 }} align="center">完了</T>
        </View>
        {drafts.map((d, i) => {
          const err = errors.get(d.key);
          const ph = previous?.sets[i];
          return (
            <View key={d.key} style={{ gap: 6, marginTop: 8 }}>
              <View style={s.setRow}>
                <T num bold size={17} style={{ width: 36 }} align="center" color={d.done ? colors.text : colors.sub}>{i + 1}</T>
                {weighted && (
                  <NumberInput
                    label={`セット${i + 1}の重量`}
                    value={d.weight}
                    placeholder={ph?.weightKg != null ? trimNumber(kgToUnit(ph.weightKg, unit)) : '重量'}
                    onChange={(t) => update(d.key, { weight: t })}
                    error={!!err?.weight}
                    decimal
                  />
                )}
                <NumberInput
                  label={`セット${i + 1}の回数`}
                  value={d.reps}
                  placeholder={ph ? String(ph.reps) : '回数'}
                  onChange={(t) => update(d.key, { reps: t })}
                  error={!!err?.reps}
                />
                <Pressable
                  accessibilityRole="checkbox"
                  aria-checked={d.done}
                  accessibilityLabel={`セット${i + 1}の完了`}
                  onPress={() => update(d.key, { done: !d.done })}
                  style={[s.done, d.done ? { backgroundColor: colors.accent } : { backgroundColor: colors.input }]}
                >
                  <Icon name="check" size={20} color={d.done ? colors.onAccent : colors.sub} />
                </Pressable>
              </View>
              {(err?.weight || err?.reps || err?.memo) && (
                <T size={12} color={colors.danger} style={{ marginLeft: 44 }}>{[err.weight, err.reps, err.memo].filter(Boolean).join('・')}</T>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 44 }}>
                <View style={s.memo}>
                  <Icon name="pencil" size={14} color={colors.sub} />
                  <Input
                    value={d.memo}
                    onChangeText={(t) => update(d.key, { memo: t })}
                    maxLength={MEMO_MAX_LENGTH}
                    placeholder="メモを追加"
                    placeholderTextColor={colors.sub}
                    accessibilityLabel={`セット${i + 1}のメモ`}
                    style={{ flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 6, minHeight: 32 }}
                  />
                </View>
                <IconButton name="close" label={`セット${i + 1}を削除`} size={32} bg="transparent" color={colors.sub} onPress={() => remove(i)} />
              </View>
            </View>
          );
        })}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Button label="セットを追加" icon="plus" variant="secondary" small style={{ flex: 1 }} onPress={() => setDrafts((ds) => [...ds, blank()])} />
          <Button
            label="上のセットをコピー"
            icon="copy"
            variant="secondary"
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

function NumberInput({ value, placeholder, onChange, error, decimal, label }: {
  value: string; placeholder: string; onChange: (t: string) => void; error?: boolean; decimal?: boolean; label: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Input
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={error ? colors.sub : '#5A616C'}
      keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
      accessibilityLabel={label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      selectTextOnFocus
      style={[
        s.input,
        focused && { borderColor: colors.accent },
        error && { borderColor: colors.danger },
      ]}
    />
  );
}

const s = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, minWidth: 0, width: 0, height: 48, borderRadius: 10, backgroundColor: colors.input, borderWidth: 1.5, borderColor: colors.input,
    color: colors.text, fontFamily: fonts.bold, fontSize: 18, textAlign: 'center',
  },
  done: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  memo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 10 },
  banner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.input, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
});
