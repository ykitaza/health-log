import { router, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { DayPickerSheet } from '@/components/DayPicker';
import { Icon } from '@/components/Icon';
import { Mono, ScanFrame } from '@/components/injuries';
import { Input } from '@/components/Input';
import { PressableScale, Sheet } from '@/components/motion';
import { INJURY_AMBER, MuscleFigure } from '@/components/MuscleFigure';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Chip, Header, ListRow } from '@/components/ui';
import type { Exercise } from '@/db/repositories/catalog';
import { useBusy } from '@/hooks/busy';
import { useConfirmDiscard } from '@/hooks/confirmDiscard';
import { useRepos } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { formatJpDate } from '@/lib/date';
import { big3RoleById } from '@/lib/exercises';
import {
  injuryInputError, InjuryInput, isSided, isSiteCode, phasesFor, Side, SIDE_NAMES, SITE_CODES, siteDetail, siteLabel, SITES,
} from '@/lib/injuries';
import { INJURY_LIMITS } from '@/lib/limits';
import { FigureTarget, MuscleView, targetsNear } from '@/lib/muscleFigure';
import { colors, fonts, radius, space, toneColors } from '@/theme';

const FIG_H = 220;

const EMPTY = (today: string): InjuryInput => ({ occurredOn: today, site: '', side: null, exerciseId: null, phase: '', symptom: '', cause: '', fix: '' });

/**
 * ケガを記録する（?id= なら直す）。Figma「ケガ 3. 記録する」。
 * 部位は前・後ろの図を押して選ぶ（押した点のいちばん近い部位。図の上の部位は小さいので、近くの部位を 48dp のチップで出して選び直せる）。
 * 読み上げでも選べるように「一覧から選ぶ」も置く。左右は選んだあとに「右・左」で直せる。
 * 種目（なしでもよい）、場面（種目に合わせた候補か、自由に書く。1つ）、何が起きたか、原因（自分の分析）、次はこう直す。痛めた日は今日から変えられる
 */
export default function InjuryFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const repos = useRepos();
  const today = useToday();
  const [form, setForm] = useState<InjuryInput>(() => EMPTY(today));
  const [initial, setInitial] = useState<InjuryInput | null>(id ? null : EMPTY(today));
  const [fixedOn, setFixedOn] = useState<string | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [roles, setRoles] = useState<ReturnType<typeof big3RoleById>>(new Map());
  const [near, setNear] = useState<FigureTarget[]>([]);
  const [freePhase, setFreePhase] = useState(false);
  const [sheet, setSheet] = useState<'site' | 'exercise' | 'date' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    repos.catalog.listExercises({ includeHidden: true }).then((all) => {
      setExercises(all);
      setRoles(big3RoleById(all));
    }).catch(() => {});
    if (!id) return;
    repos.injuries.get(id).then((i) => {
      if (!i) { setMissing(true); return; }
      const v: InjuryInput = {
        occurredOn: i.occurredOn, site: i.site, side: i.side, exerciseId: i.exerciseId, phase: i.phase, symptom: i.symptom, cause: i.cause, fix: i.fix,
      };
      setForm(v);
      setInitial(v);
      setFixedOn(i.fixedOn);
    }).catch(() => setMissing(true));
  }, [id, repos]);

  const dirty = initial != null && JSON.stringify(form) !== JSON.stringify(initial);
  const { dialog, allowLeave } = useConfirmDiscard(dirty, id ? '直した内容は保存されません。' : '入力したケガは記録されません。');
  const set = (patch: Partial<InjuryInput>) => { setForm((f) => ({ ...f, ...patch })); setError(null); };
  const exercise = exercises.find((e) => e.id === form.exerciseId) ?? null;
  const phases = phasesFor(form.exerciseId ? roles.get(form.exerciseId) : null);
  const free = freePhase || (form.phase !== '' && !phases.includes(form.phase));
  // 選べる種目：表示中のものと、今の種目（非表示にしたものでも、直すときは残す）
  const choices = useMemo(() => exercises.filter((e) => !e.hidden || e.id === form.exerciseId), [exercises, form.exerciseId]);

  // 種目を変えたら、前の種目の候補から選んだ場面は外す（自由に書いた場面は残す）
  const pickExercise = (exerciseId: string | null) => {
    const next = phasesFor(exerciseId ? roles.get(exerciseId) : null);
    set({ exerciseId, ...(!free && form.phase !== '' && !next.includes(form.phase) ? { phase: '' } : {}) });
  };
  const choose = (site: string, side: Side | null) => set({ site, side: isSided(site) ? side ?? 'right' : null });
  const onPick = (view: MuscleView) => (t: FigureTarget | null, p: { x: number; y: number }) => {
    setNear(targetsNear(view, p));
    if (t) choose(t.site, t.side);
  };

  const { busy, run } = useBusy();
  const submit = () => run(async (stayBusy) => {
    const e = injuryInputError(form, today, fixedOn);
    if (e) { setError(e); return; }
    try {
      if (id) await repos.injuries.update(id, form);
      else await repos.injuries.create(form);
      stayBusy();
      allowLeave();
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/training?view=injury'));
  if (missing) {
    return <Screen><Header title="ケガの記録が見つかりません" onBack={back} /><T color={colors.sub}>消されたか、まだ届いていない記録です。</T></Screen>;
  }
  const label = isSiteCode(form.site) ? siteLabel(form.site, form.side) : null;

  return (
    <Screen
      footer={(
        <>
          {error && <T variant="bodyM" color={colors.danger} align="center" accessibilityLiveRegion="polite">{error}</T>}
          <Button label={busy ? '保存しています…' : id ? '保存する' : '記録する'} icon="check" onPress={submit} busy={busy} testID="injury-save" />
        </>
      )}
    >
      {dialog}
      <Header overline="筋トレ ・ ケガ" title={id ? 'ケガを直す' : 'ケガを記録'} onBack={back} />

      <ScanFrame style={{ padding: space.l, marginTop: space.s }} testID="injury-site">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T variant="titleS" color={colors.sub}>部位</T>
          <Mono>TAP TO SELECT</Mono>
        </View>
        <View style={{ flexDirection: 'row', marginTop: space.s, gap: space.m }}>
          <View style={{ flex: 1, justifyContent: 'center', gap: space.xs }}>
            {label ? (
              <>
                <Mono color={INJURY_AMBER} size={11}>SELECTED</Mono>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`${label}を外す`}
                  onPress={() => { set({ site: '', side: null }); setNear([]); }}
                  style={s.selected}
                >
                  <T variant="titleM" color={INJURY_AMBER} testID="injury-selected">{label}</T>
                  <Icon name="close" size={18} color={INJURY_AMBER} />
                </PressableScale>
                <T variant="bodyS" color={colors.sub}>{siteDetail(form.site)}</T>
              </>
            ) : (
              <T variant="bodyM" color={colors.sub}>前・後ろの図で、痛む場所を押す</T>
            )}
          </View>
          <View style={{ alignItems: 'center' }}>
            <MuscleFigure view="front" width={FIG_H / 2} height={FIG_H} selected={form.site ? { site: form.site, side: form.side } : null}
              onPick={onPick('front')} testID="injury-figure-front" />
            <Mono size={11}>R FRONT L</Mono>
          </View>
          <View style={{ alignItems: 'center' }}>
            <MuscleFigure view="back" width={FIG_H / 2} height={FIG_H} selected={form.site ? { site: form.site, side: form.side } : null}
              onPick={onPick('back')} testID="injury-figure-back" />
            <Mono size={11}>L BACK R</Mono>
          </View>
        </View>
        {near.length > 1 && (
          <View style={{ marginTop: space.s }}>
            <T variant="bodyS" color={colors.sub}>近くの部位</T>
            <View style={s.wrap}>
              {near.map((t) => (
                <Chip key={`${t.site}-${t.side}`} label={siteLabel(t.site, t.side)} active={t.site === form.site && (t.side ?? null) === form.side}
                  onPress={() => choose(t.site, t.side)} />
              ))}
            </View>
          </View>
        )}
        {isSided(form.site) && (
          <View style={[s.wrap, { marginTop: space.xs }]}>
            {(['right', 'left'] as Side[]).map((side) => (
              <Chip key={side} label={SIDE_NAMES[side]} active={form.side === side} accessibilityLabel={`${SIDE_NAMES[side]}側`} onPress={() => set({ side })} />
            ))}
          </View>
        )}
        <Button label="一覧から選ぶ" variant="text" icon="search" small onPress={() => setSheet('site')} style={{ alignSelf: 'flex-start', marginTop: space.xs }} />
      </ScanFrame>

      <Label title="痛めた日" en="DATE" />
      <SelectRow label={formatJpDate(form.occurredOn)} icon="calendar" a11y={`痛めた日、${formatJpDate(form.occurredOn)}。日を選ぶ`} onPress={() => setSheet('date')} />

      <Label title="種目" en="EXERCISE" />
      <SelectRow label={exercise?.name ?? '種目なし'} icon="down" a11y={`種目、${exercise?.name ?? 'なし'}。選ぶ`} onPress={() => setSheet('exercise')} testID="injury-exercise" />

      <Label title="場面" en="PHASE" />
      <View style={s.wrap}>
        {phases.map((p) => (
          <Chip key={p} label={p} active={!free && form.phase === p} onPress={() => { setFreePhase(false); set({ phase: form.phase === p ? '' : p }); }} />
        ))}
        <Chip label="自由に書く" active={free} onPress={() => { setFreePhase(true); if (phases.includes(form.phase)) set({ phase: '' }); }} />
      </View>
      {free && (
        <TextField value={form.phase} onChange={(phase) => set({ phase })} label="場面" placeholder="例：3セット目の下ろしたとき" max={INJURY_LIMITS.phase} />
      )}

      <Label title="症状のひとこと" en="WHAT" />
      <TextField value={form.symptom} onChange={(symptom) => set({ symptom })} label="症状のひとこと" placeholder="例：前側にピリッとした痛み" max={INJURY_LIMITS.symptom} />
      <Label title="原因（自分の分析）" en="CAUSE" />
      <TextField value={form.cause} onChange={(cause) => set({ cause })} label="原因（自分の分析）" placeholder="例：肩でバーベルを持ち上げてしまっている" max={INJURY_LIMITS.cause} multiline />
      <Label title="次はこう直す" en="FIX" />
      <TextField value={form.fix} onChange={(fix) => set({ fix })} label="次はこう直す" placeholder="例：肩甲骨を寄せてから、腕を伸ばして外す" max={INJURY_LIMITS.fix} multiline />

      <Sheet visible={sheet === 'site'} onClose={() => setSheet(null)}>
        <SheetBody title="部位を選ぶ">
          {(['muscle', 'joint'] as const).map((kind) => (
            <View key={kind} style={{ marginTop: space.m }}>
              <T variant="titleS" color={colors.sub} accessibilityRole="header">{kind === 'muscle' ? '筋肉' : '関節'}</T>
              <View style={s.wrap}>
                {SITE_CODES.filter((c) => SITES[c].kind === kind).map((c) => (
                  <Chip key={c} label={SITES[c].short} active={form.site === c}
                    onPress={() => { choose(c, form.side); setNear([]); setSheet(null); }} />
                ))}
              </View>
            </View>
          ))}
        </SheetBody>
      </Sheet>

      <Sheet visible={sheet === 'exercise'} onClose={() => setSheet(null)}>
        <SheetBody title="種目を選ぶ">
          <ListRow first title="種目なし" chevron={false} onPress={() => { pickExercise(null); setSheet(null); }}
            right={form.exerciseId == null ? <Icon name="check" color={colors.accent} /> : undefined} />
          {choices.map((e) => (
            <ListRow key={e.id} title={e.name} subtitle={e.bodyPartName} chevron={false}
              onPress={() => { pickExercise(e.id); setSheet(null); }}
              right={form.exerciseId === e.id ? <Icon name="check" color={colors.accent} /> : undefined} />
          ))}
        </SheetBody>
      </Sheet>

      <DayPickerSheet visible={sheet === 'date'} kind="training" value={form.occurredOn} today={today} onClose={() => setSheet(null)}
        onPick={(d) => set({ occurredOn: d })} />
    </Screen>
  );
}

function Label({ title, en }: { title: string; en: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s, marginTop: space.l, marginBottom: space.s }}>
      <T variant="titleS" color={colors.sub}>{title}</T>
      <Mono size={11}>{en}</Mono>
    </View>
  );
}

function SelectRow({ label, icon, a11y, onPress, testID }: { label: string; icon: 'calendar' | 'down'; a11y: string; onPress: () => void; testID?: string }) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} scaleTo={0.98} style={s.select} testID={testID}>
      <T variant="bodyL" style={{ flex: 1 }} numberOfLines={1}>{label}</T>
      <Icon name={icon} color={colors.sub} size={24} />
    </PressableScale>
  );
}

function TextField({ value, onChange, label, placeholder, max, multiline }: {
  value: string; onChange: (t: string) => void; label: string; placeholder: string; max: number; multiline?: boolean;
}) {
  return (
    <Input
      value={value}
      onChangeText={onChange}
      accessibilityLabel={label}
      placeholder={placeholder}
      placeholderTextColor={colors.sub}
      maxLength={max * 2}
      multiline={multiline}
      style={[s.input, multiline && { minHeight: 56, paddingVertical: space.m, textAlignVertical: 'top' }]}
    />
  );
}

function SheetBody({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.xl }}>
      <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: colors.sub, marginBottom: space.l }} />
      <T variant="headlineS" accessibilityRole="header">{title}</T>
      <ScrollView style={{ maxHeight: 480, marginTop: space.s }}>{children}</ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.s },
  selected: {
    flexDirection: 'row', alignItems: 'center', gap: space.s, alignSelf: 'flex-start', minHeight: 48, paddingHorizontal: space.m,
    borderRadius: radius.s, borderWidth: 1, borderColor: INJURY_AMBER, backgroundColor: toneColors.caution.container,
  },
  select: {
    flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.l, borderRadius: radius.m, borderWidth: 1,
    borderColor: colors.outline, backgroundColor: colors.input,
  },
  input: {
    minHeight: 56, borderRadius: radius.m, borderWidth: 1, borderColor: colors.outline, backgroundColor: colors.input, color: colors.text,
    fontFamily: fonts.regular, fontSize: 16, paddingHorizontal: space.l,
  },
});
