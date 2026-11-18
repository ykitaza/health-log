// 筋トレの入力画面の「直すこと」の帯（Figma「ケガ 4. 筋トレの入力画面に出る『直すこと』」）。
// 直している途中のケガで、種目がこの画面の種目と同じものを出し、直し方を思い出させる。終わったら振り返りを書ける
import { router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import type { Injury } from '@/db/repositories/injuries';
import { useBusy } from '@/hooks/busy';
import { useFocusData } from '@/hooks/data';
import { bandText, bandWhere, injuriesForExercise, RESULT_KEYS, ReviewResult, RESULTS, reviewOnDate } from '@/lib/injuries';
import { cautionBand, colors, onToneSub, radius, space, toneColors } from '@/theme';
import { duration } from '@/theme/motion';
import { Icon } from './Icon';
import { ReviewDraft, ReviewSheet } from './injuries';
import { easeOut } from './motion';
import { INJURY_AMBER } from './MuscleFigure';
import { T } from './Text';
import { ConfirmDialog } from './ui';

/** 帯の入口のチップ（Figma と同じ文言。「痛みが出た」は、シートと年表では「痛んだ」） */
const CHIPS: Record<ReviewResult, { label: string; fg: string; bg: string }> = {
  fixed: { label: `${RESULTS.fixed.mark} ${RESULTS.fixed.label}`, fg: colors.onAccentDark, bg: colors.accentDark },
  not_yet: { label: `${RESULTS.not_yet.mark} ${RESULTS.not_yet.label}`, fg: INJURY_AMBER, bg: toneColors.caution.container },
  pain: { label: `${RESULTS.pain.mark} 痛みが出た`, fg: colors.text, bg: colors.line },
};

type Item = { injury: Injury; reviewed: ReviewResult | null };

/**
 * 直している途中で種目が同じケガを、新しい順に2件まで帯で出す（残りは「ほか N 件」）。帯を押すとケガの1件を開く。
 * 帯の下の「終わったら ✓直せた △まだ ！痛みが出た」で、その結果を選んだ振り返りのシートを開く（日付はこの画面の日付、種目はこの種目）。
 * 「直せた」を足したら、ケガを直せたにするかを聞く。同じ日に振り返り済みなら、入口は「振り返り済み（✓直せた）」にして、押すと1件を開く。
 * 未来の日は振り返りを書けないので、入口を出さない
 */
export function InjuryBand({ exerciseId, exerciseName, date, today }: { exerciseId: string; exerciseName: string; date: string; today: string }) {
  const { data, reload, repos } = useFocusData(async (r) => {
    const { shown, more } = injuriesForExercise(await r.injuries.list(), exerciseId);
    const reviewed = await Promise.all(shown.map(async (i) => reviewOnDate(await r.injuries.reviews(i.id), date)));
    return { items: shown.map((injury, n): Item => ({ injury, reviewed: reviewed[n] })), more };
  }, `${exerciseId}:${date}`);
  const [draft, setDraft] = useState<(ReviewDraft & { injuryId: string }) | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [askFixed, setAskFixed] = useState<string | null>(null);
  const { busy, run } = useBusy();

  const open = (injuryId: string, result: ReviewResult) => {
    setDraftError(null);
    setDraft({ injuryId, date, result, note: '', withExercise: true });
  };
  const save = () => run(async () => {
    if (!draft) return;
    try {
      await repos.injuries.addReview(draft.injuryId, { date: draft.date, result: draft.result, note: draft.note, exerciseId });
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
      return;
    }
    setDraft(null);
    await reload();
    // 帯に出すのは直している途中のケガだけなので、直せたを選んだら必ず聞く（自動では閉じない）
    if (draft.result === 'fixed') setAskFixed(draft.injuryId);
  });
  const setFixed = (injuryId: string) => run(async () => {
    setAskFixed(null);
    await repos.injuries.setStatus(injuryId, 'fixed');
    await reload();
  });

  const items = data?.items ?? [];
  return (
    <>
      {items.length > 0 && (
        <View style={{ gap: space.s, marginTop: space.s }} testID="injury-band">
          {items.map((it) => (
            <Appear key={it.injury.id}>
              <Band item={it} canReview={date <= today} onReview={(result) => open(it.injury.id, result)} />
            </Appear>
          ))}
          {/* 押せない文字にする（一覧へ移ると、入力中のセットを置いて画面を離れるため。残りは筋トレの「ケガ」で見る） */}
          {data!.more > 0 && (
            <T variant="bodyS" color={colors.sub} align="right" accessibilityLabel={`ほか${data!.more}件の直している途中のケガがあります`} testID="injury-band-more">
              {`ほか ${data!.more} 件`}
            </T>
          )}
        </View>
      )}
      <ReviewSheet
        draft={draft}
        onChange={(d) => { setDraft({ ...d, injuryId: draft!.injuryId }); setDraftError(null); }}
        today={today}
        exerciseName={exerciseName}
        locked
        error={draftError}
        busy={busy}
        onClose={() => setDraft(null)}
        onSave={save}
      />
      <ConfirmDialog
        visible={askFixed != null}
        title="このケガを直せたにしますか？"
        body="振り返りで「直せた」を選びました。直せたにすると、一覧の「直せた」に移り、この帯も出なくなります。あとで直している途中に戻せます。"
        confirmLabel="直せたにする"
        cancelLabel="途中のままにする"
        danger={false}
        busy={busy}
        onCancel={() => setAskFixed(null)}
        onConfirm={() => askFixed && setFixed(askFixed)}
      />
    </>
  );
}

function Band({ item, canReview, onReview }: { item: Item; canReview: boolean; onReview: (r: ReviewResult) => void }) {
  const { injury, reviewed } = item;
  const where = bandWhere(injury);
  const text = bandText(injury);
  const openDetail = () => router.push(`/injuries/${injury.id}`);
  return (
    <View style={s.band}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`直すこと、${text}。${where}。押すとケガの記録を開く`}
        onPress={openDetail}
        style={s.head}
        testID={`injury-band-${injury.id}`}
      >
        <Icon name="alert" size={24} color={INJURY_AMBER} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <T variant="labelM" color={INJURY_AMBER}>直すこと</T>
            <T size={11} color={onToneSub} numberOfLines={1} style={{ flexShrink: 1 }}>{where}</T>
          </View>
          <T size={15} bold numberOfLines={2}>{text}</T>
        </View>
        <Icon name="chevron" size={24} color={colors.text} />
      </Pressable>
      {canReview && (
        <>
          <View style={s.divider} />
          {reviewed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`振り返り済み、${RESULTS[reviewed].label}（${where}）。押すとケガの記録を開く`}
              onPress={openDetail}
              style={s.reviewRow}
              testID={`injury-band-reviewed-${injury.id}`}
            >
              <T variant="bodyS" color={onToneSub}>{`振り返り済み（${RESULTS[reviewed].mark}${RESULTS[reviewed].label}）`}</T>
              <Icon name="chevron" size={16} color={onToneSub} />
            </Pressable>
          ) : (
            <View style={s.reviewRow} accessibilityLabel="終わったら振り返りを書く">
              <T variant="bodyS" color={onToneSub}>終わったら</T>
              {RESULT_KEYS.map((k) => (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={`振り返りを書く：${CHIPS[k].label}（${where}）`}
                  onPress={() => onReview(k)}
                  style={s.chipTouch}
                  testID={`injury-band-${k}-${injury.id}`}
                >
                  <View style={[s.chip, { backgroundColor: CHIPS[k].bg }]}>
                    <T variant="labelM" color={CHIPS[k].fg}>{CHIPS[k].label}</T>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

/** 出てくる動き：250ms の ease-out で、下から少し上がりながら濃くなる。消えるときは動かさない。動きを減らす設定ならすぐに出す */
function Appear({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) { p.set(1); return; }
    p.set(withTiming(1, { duration: duration.enter, easing: easeOut }));
  }, [reduced, p]);
  const anim = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ translateY: (1 - p.get()) * 8 }] }));
  return <Animated.View style={anim}>{children}</Animated.View>;
}

const s = StyleSheet.create({
  band: {
    backgroundColor: cautionBand, borderRadius: radius.m, borderWidth: 1, borderColor: `${INJURY_AMBER}80`,
    paddingHorizontal: space.m, paddingVertical: space.xs,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: space.xs },
  divider: { height: 1, backgroundColor: `${INJURY_AMBER}33` },
  // 見た目は高さ 32 のチップ。押せる範囲は上下を広げて 48
  // 折り返すと行の高さが中身に合うので、行もまん中に寄せる（alignContent）
  reviewRow: { flexDirection: 'row', alignItems: 'center', alignContent: 'center', flexWrap: 'wrap', columnGap: 6, minHeight: 48 },
  chipTouch: { minHeight: 48, justifyContent: 'center' },
  chip: { height: 32, borderRadius: radius.s, paddingHorizontal: 10, justifyContent: 'center' },
});
