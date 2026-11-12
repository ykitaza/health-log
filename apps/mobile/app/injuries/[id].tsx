import { router, useLocalSearchParams } from 'expo-router';
import { ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { DayPickerSheet } from '@/components/DayPicker';
import { Mono, ScanFrame, StatusBadge } from '@/components/injuries';
import { Input } from '@/components/Input';
import { LoadError } from '@/components/LoadError';
import { Sheet } from '@/components/motion';
import { INJURY_AMBER, MuscleFigure } from '@/components/MuscleFigure';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Chip, ConfirmDialog, Header, IconButton, Segmented } from '@/components/ui';
import type { InjuryReview } from '@/db/repositories/injuries';
import { useBusy } from '@/hooks/busy';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { addDays, formatJpDate, formatMonthDay, formatShortDate } from '@/lib/date';
import { injuryNumbers, RESULT_KEYS, ReviewResult, RESULTS, siteDetail, siteLabel } from '@/lib/injuries';
import { INJURY_LIMITS } from '@/lib/limits';
import { markPoint } from '@/lib/muscleFigure';
import { colors, fonts, radius, space, toneColors } from '@/theme';

/** 振り返りの結果の色（記号と文字も添える） */
const RESULT_TONE: Record<ReviewResult, { fg: string; bg: string }> = {
  fixed: { fg: colors.onAccentDark, bg: colors.accentDark },
  not_yet: { fg: INJURY_AMBER, bg: toneColors.caution.container },
  pain: { fg: colors.onDangerDark, bg: colors.dangerDark },
};

type Draft = { date: string; result: ReviewResult; note: string; withExercise: boolean };

/**
 * ケガの1件（Figma「ケガ 2. 1件の詳細」）。どこで（種目・場面）・何が起きた・原因（自分の分析）・次はこう直す（緑の枠）・
 * やってみた結果（縦の年表。✓直せた △まだ ！痛んだ）。下に「振り返りを足す」と「直せたにする」（直せたものは「直している途中に戻す」）。
 * 振り返りで「直せた」を選んだら、ケガを直せたにするかを聞く（自動では閉じない）。右上に「編集」と「消す」（振り返りも一緒に消える）
 */
export default function InjuryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [injury, reviews, all] = await Promise.all([r.injuries.get(id), r.injuries.reviews(id), r.injuries.list()]);
    return { injury, reviews, number: injuryNumbers(all).get(id) ?? '' };
  }, id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [askFixed, setAskFixed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, run } = useBusy();

  const back = () => (router.canGoBack() ? router.back() : router.replace('/training?view=injury'));
  if (error) return <Screen><Header title="ケガ" onBack={back} /><LoadError onRetry={reload} /></Screen>;
  if (data == null) return <Screen><Header title="ケガ" onBack={back} /></Screen>;
  const injury = data.injury;
  if (injury == null) {
    return <Screen><Header title="ケガの記録が見つかりません" onBack={back} /><T color={colors.sub}>消されたか、まだ届いていない記録です。</T></Screen>;
  }

  const label = siteLabel(injury.site, injury.side);
  const fixing = injury.status === 'fixing';
  const at = markPoint(injury.site, injury.side);
  const setStatus = (status: 'fixing' | 'fixed') => run(async () => {
    setAskFixed(false);
    await repos.injuries.setStatus(injury.id, status);
    await reload();
  });
  const saveReview = () => run(async () => {
    if (!draft) return;
    try {
      await repos.injuries.addReview(injury.id, {
        date: draft.date, result: draft.result, note: draft.note, exerciseId: draft.withExercise ? injury.exerciseId : null,
      });
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
      return;
    }
    const fixedNow = draft.result === 'fixed' && fixing;
    setDraft(null);
    await reload();
    if (fixedNow) setAskFixed(true);
  });
  const remove = () => run(async (stayBusy) => {
    setConfirmDelete(false);
    await repos.injuries.remove(injury.id);
    stayBusy();
    back();
  });
  const openReview = () => {
    setDraftError(null);
    setDraft({ date: today, result: 'not_yet', note: '', withExercise: injury.exerciseId != null });
  };
  const overline = ['ケガ', [injury.exerciseName ? `${injury.exerciseName}で` : '', formatMonthDay(injury.occurredOn)].join('')].join(' ・ ');

  return (
    <Screen
      footer={(
        <View style={{ flexDirection: 'row', gap: space.m }}>
          <Button label="振り返りを足す" icon="pencil" variant="tonal" onPress={openReview} disabled={busy} style={{ flex: 1 }} testID="injury-review" />
          {fixing ? (
            <Button label="直せたにする" icon="check" onPress={() => setStatus('fixed')} disabled={busy} style={{ flex: 1 }} testID="injury-fixed" />
          ) : (
            <Button label="直している途中に戻す" variant="secondary" onPress={() => setStatus('fixing')} disabled={busy} style={{ flex: 1 }} testID="injury-reopen" />
          )}
        </View>
      )}
    >
      <Header
        overline={overline}
        title={label}
        badge={<StatusBadge status={injury.status} />}
        onBack={back}
        right={(
          <View style={{ flexDirection: 'row' }}>
            <IconButton name="pencil" label="編集" color={colors.accent} onPress={() => router.push(`/injuries/new?id=${injury.id}`)} testID="injury-edit" />
            <IconButton name="trash" label="このケガの記録を消す" color={colors.danger} disabled={busy} onPress={() => setConfirmDelete(true)} testID="injury-delete" />
          </View>
        )}
      />

      <ScanFrame style={{ paddingHorizontal: space.l, paddingVertical: space.m, marginTop: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Mono color={fixing ? INJURY_AMBER : colors.accent} size={12}>{`TARGET · ${data.number}`}</Mono>
            <T variant="titleM">{`${label} ／ ${siteDetail(injury.site)}`}</T>
            {(injury.exerciseName || injury.phase) && (
              <T variant="bodyM" color={colors.sub}>{[injury.exerciseName, injury.phase].filter(Boolean).join(' ／ ')}</T>
            )}
            <T variant="bodyS" color={colors.sub}>
              {`${formatShortDate(injury.occurredOn)} 記録 ・ 振り返り ${data.reviews.length}回${injury.status === 'fixed' && injury.fixedOn ? ` ・ ${formatShortDate(injury.fixedOn)} 直せた` : ''}`}
            </T>
          </View>
          {at && (
            <View style={{ alignItems: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <MuscleFigure view={at.view} width={70} height={140}
                marks={[{ key: injury.id, site: injury.site, side: injury.side, status: injury.status }]} />
              <Mono size={11}>{at.view === 'front' ? 'R FRONT L' : 'L BACK R'}</Mono>
            </View>
          )}
        </View>
      </ScanFrame>

      <Block title="どこで" no="01 / WHERE">
        {injury.exerciseName || injury.phase ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {[injury.exerciseName, injury.phase].filter((x): x is string => !!x).map((x) => (
              <View key={x} style={s.tag}><T variant="labelL">{x}</T></View>
            ))}
          </View>
        ) : <Empty />}
        <View style={s.divider} />
        <BlockHead title="何が起きた" no="02 / WHAT" />
        <T variant="bodyL">{injury.symptom ? `${label} ／ ${injury.symptom}` : label}</T>
      </Block>

      <Block title="原因（自分の分析）" no="03 / CAUSE">
        {injury.cause ? <T variant="bodyL">{injury.cause}</T> : <Empty />}
      </Block>

      <Block title="次はこう直す" no="04 / FIX" strong>
        {injury.fix ? <T variant="bodyL" bold>{injury.fix}</T> : <Empty />}
      </Block>

      <Block title="やってみた結果" no="05 / LOG">
        {data.reviews.length === 0 ? (
          <T variant="bodyM" color={colors.sub}>まだありません。直し方を試したら「振り返りを足す」で残せます。</T>
        ) : (
          <View testID="injury-log">{data.reviews.map((r, i) => <LogItem key={r.id} review={r} last={i === data.reviews.length - 1} />)}</View>
        )}
      </Block>

      <Sheet visible={draft != null && !picking} onClose={() => setDraft(null)}>
        {draft && (
          <View style={{ paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.xl, gap: space.m }}>
            <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: colors.sub }} />
            <T variant="headlineS" accessibilityRole="header">振り返りを足す</T>
            <View style={{ gap: space.xs }}>
              <T variant="titleS" color={colors.sub}>試した日</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.s }}>
                <Chip label="今日" active={draft.date === today} onPress={() => setDraft({ ...draft, date: today })} />
                <Chip label="昨日" active={draft.date === addDays(today, -1)} onPress={() => setDraft({ ...draft, date: addDays(today, -1) })} />
                <Chip
                  label={draft.date < addDays(today, -1) ? formatJpDate(draft.date) : 'ほかの日'}
                  active={draft.date < addDays(today, -1)}
                  accessibilityLabel={`ほかの日を選ぶ${draft.date < addDays(today, -1) ? `、${formatJpDate(draft.date)}` : ''}`}
                  onPress={() => setPicking(true)}
                />
              </View>
            </View>
            <View style={{ gap: space.xs }}>
              <T variant="titleS" color={colors.sub}>結果</T>
              <Segmented<ReviewResult>
                options={RESULT_KEYS.map((k) => ({ key: k, label: `${RESULTS[k].mark} ${RESULTS[k].label}` }))}
                value={draft.result}
                onChange={(result) => setDraft({ ...draft, result })}
              />
            </View>
            {injury.exerciseName && (
              <Chip label={`${injury.exerciseName}で試した`} active={draft.withExercise} onPress={() => setDraft({ ...draft, withExercise: !draft.withExercise })} />
            )}
            <Input
              value={draft.note}
              onChangeText={(note) => { setDraft({ ...draft, note }); setDraftError(null); }}
              accessibilityLabel="メモ"
              placeholder="例：寄せてから外せた"
              placeholderTextColor={colors.sub}
              maxLength={INJURY_LIMITS.reviewNote * 2}
              multiline
              style={s.input}
            />
            {draftError && <T variant="bodyM" color={colors.danger} accessibilityLiveRegion="polite">{draftError}</T>}
            <Button label={busy ? '保存しています…' : '足す'} icon="check" onPress={saveReview} busy={busy} testID="review-save" />
          </View>
        )}
      </Sheet>
      {draft && (
        <DayPickerSheet visible={picking} kind="training" value={draft.date} today={today} onClose={() => setPicking(false)}
          onPick={(date) => setDraft({ ...draft, date })} />
      )}

      <ConfirmDialog
        visible={askFixed}
        title="このケガを直せたにしますか？"
        body="振り返りで「直せた」を選びました。直せたにすると、一覧の「直せた」に移ります。あとで直している途中に戻せます。"
        confirmLabel="直せたにする"
        cancelLabel="途中のままにする"
        danger={false}
        busy={busy}
        onCancel={() => setAskFixed(false)}
        onConfirm={() => setStatus('fixed')}
      />
      <ConfirmDialog
        visible={confirmDelete}
        title="ケガの記録を消しますか？"
        body={`「${label}」の記録を消します。${data.reviews.length > 0 ? `振り返り（${data.reviews.length}件）も一緒に消えます。` : ''}`}
        confirmLabel="消す"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </Screen>
  );
}

function BlockHead({ title, no, strong }: { title: string; no: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: space.s }}>
      <T variant="titleS" color={strong ? colors.accent : colors.sub} accessibilityRole="header">{title}</T>
      <Mono size={12}>{no}</Mono>
    </View>
  );
}

function Block({ title, no, strong, children }: { title: string; no: string; strong?: boolean; children: ReactNode }) {
  return (
    <View style={[s.block, strong && { borderColor: colors.accentMuted, borderWidth: 1 }]}>
      <BlockHead title={title} no={no} strong={strong} />
      {children}
    </View>
  );
}

const Empty = () => <T variant="bodyM" color={colors.sub}>書いていません</T>;

/** 縦の年表の1件：点（直せたは塗り、まだは輪、痛んだは赤の輪）、日付、結果の札（記号つき）、種目、メモ */
function LogItem({ review, last }: { review: InjuryReview; last: boolean }) {
  const tone = RESULT_TONE[review.result];
  const r = RESULTS[review.result];
  return (
    <View style={{ flexDirection: 'row', gap: space.m }} accessible accessibilityLabel={`${formatMonthDay(review.date)}、${r.label}。${review.exerciseName ?? ''}${review.note ? `。${review.note}` : ''}`}>
      <View style={{ alignItems: 'center', width: 16 }}>
        <View style={[s.logDot, review.result === 'fixed'
          ? { backgroundColor: colors.accent, borderColor: colors.accent }
          : { borderColor: review.result === 'pain' ? colors.danger : INJURY_AMBER }]} />
        {!last && <View style={s.logLine} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : space.l, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }}>
          <T num size={16}>{review.date.slice(5).replace('-', '/')}</T>
          <View style={[s.result, { backgroundColor: tone.bg }]}>
            <T variant="labelM" color={tone.fg}>{`${r.mark}${r.label}`}</T>
          </View>
          {review.exerciseName && <T variant="bodyS" color={colors.sub}>{review.exerciseName}</T>}
        </View>
        {review.note !== '' && <T variant="bodyL">{review.note}</T>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  block: { backgroundColor: colors.card, borderRadius: radius.l, padding: space.l, marginTop: space.m, borderWidth: 1, borderColor: 'transparent' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.m },
  tag: { borderWidth: 1, borderColor: colors.outline, borderRadius: radius.s, paddingHorizontal: space.m, paddingVertical: space.xs, backgroundColor: colors.input },
  logDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, marginTop: 4 },
  logLine: { flex: 1, width: 1, backgroundColor: colors.outline, marginTop: 2 },
  result: { borderRadius: radius.s, paddingHorizontal: space.s, paddingVertical: 2 },
  input: {
    minHeight: 72, borderRadius: radius.m, borderWidth: 1, borderColor: colors.outline, backgroundColor: colors.input, color: colors.text,
    fontFamily: fonts.regular, fontSize: 16, paddingHorizontal: space.l, paddingVertical: space.m, textAlignVertical: 'top',
  },
});
