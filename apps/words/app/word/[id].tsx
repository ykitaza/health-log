import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { TagAdd } from '@/components/TagAdd';
import { Button, Chip, ConfirmDialog, Field, IconButton, Notice, Screen, SectionTitle, Sheet, T } from '@/components/ui';
import { Bookmark, Seal } from '@/components/wa';
import type { TagLink } from '@/db/repositories/words';
import { useData, useRepos } from '@/hooks/data';
import { useNotifications } from '@/hooks/notifications';
import { makeCloze } from '@/lib/cloze';
import { formatMonthDay, jstDate } from '@/lib/date';
import { normalizedKey } from '@/lib/normalize';
import { orderedExamples } from '@/lib/examples';
import { ownReady } from '@/lib/schedule';
import {
  HAND_LIMIT, Place, PLACE_LABELS, Register, REGISTER_LABELS, REGISTERS, STAGE_LABELS, TAG_KIND_LABELS, TagKind,
} from '@/lib/types';
import { colors, fonts, space, TOUCH } from '@/theme';

type Edit = { text: string; reading: string; scene: string; use_note: string; note: string };

/**
 * 言葉の詳細（Figma の 5-detail）。表現・読み・出どころ・意味とニュアンス（Claude が補った）・探すときの手がかり（タグ）・
 * 似た言葉・また出会った・段階と次の期限・手札に入れる／使えた／戻す・消す（確認つき）
 */
export default function WordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const repos = useRepos();
  const notifications = useNotifications();
  const { data } = useData(async (r) => {
    const e = await r.words.get(id);
    if (!e) return { e: null } as const;
    const [encounters, tags, allTags, sources, handCount, useDays, all, links] = await Promise.all([
      r.words.encounters(id), r.words.tagsOf(id), r.catalog.tags(), r.catalog.sources(), r.words.handCount(), r.words.useDays(id),
      r.words.listAll(), r.words.allTagLinks(),
    ]);
    return { e, examples: orderedExamples(e.examples), encounters, tags, allTags, sources, handCount, useDays, all, links };
  }, [id]);
  const [played, setPlayed] = useState<'bookmark' | 'seal' | null>(null);
  const [editTags, setEditTags] = useState(false);
  const [editExamples, setEditExamples] = useState(false);
  const [newExample, setNewExample] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!data) return <Screen><View /></Screen>;
  if (!data.e) {
    return (
      <Screen>
        <IconButton name="back" label="戻る" onPress={() => router.back()} style={{ marginLeft: -space.m, marginTop: space.l }} />
        <T variant="body">この言葉は見つかりませんでした（消されたかもしれません）。</T>
      </Screen>
    );
  }
  const { e, examples, encounters, tags, allTags, sources, handCount, useDays, all, links } = data;
  const sourceName = (sid: string | null) => sources.find((s) => s.id === sid)?.name ?? null;
  const first = encounters[0];
  const cloze = makeCloze(e.text, [...encounters].reverse());
  const clozeEnc = encounters.find((x) => x.surrounding_text.trim() !== '');

  const move = async (to: Place) => {
    const r = await repos.words.move(e.id, to);
    if (!r.ok) { setNotice(`手札がいっぱいです（${HAND_LIMIT}枚まで）。1枚戻してから入れてください`); return; }
    if (to === 'hand') { setPlayed('bookmark'); await notifications.askOnce(); } else setPlayed(null);
    setNotice(to === 'hand' ? '手札に入れました' : to === 'own' ? '自分の言葉にしました' : '拾ったに戻しました');
    void notifications.reschedule();
  };

  const used = async () => {
    await repos.words.recordUse(e.id);
    setPlayed('seal');
    setNotice('使えた、を記録しました');
    void notifications.reschedule();
  };

  const saveEdit = async () => {
    if (!edit) return;
    if (!edit.text.trim()) { setNotice('表現は空にできません'); return; }
    const same = normalizedKey(edit.text) !== e.normalized_key && all.some((x) => x.id !== e.id && x.normalized_key === normalizedKey(edit.text));
    if (same) { setNotice('同じ表現がもうあります'); return; }
    await repos.words.updateUserFields(e.id, edit);
    setEdit(null);
  };

  const remove = async () => {
    setConfirmDelete(false);
    await repos.words.remove(e.id);
    router.back();
  };

  const tagChip = (t: TagLink) => {
    const proposed = t.status === 'proposed';
    const who = t.added_by === 'claude' ? (proposed ? 'Claude の案' : 'Claude が付けて、確かめた') : '自分で付けた';
    return (
      <Chip
        key={t.id}
        label={t.name}
        variant={proposed ? 'proposed' : 'confirmed'}
        accessibilityLabel={`${t.name}、${who}${proposed ? '。押すと確かめる' : ''}`}
        onPress={proposed ? () => repos.words.confirmTag(t.id) : undefined}
        onRemove={editTags ? () => repos.words.removeTag(t.id) : undefined}
        testID={`tag-${t.name}`}
      />
    );
  };

  const tagRow = (kind: TagKind) => (
    <View style={s.tagRow} key={kind}>
      <T variant="bodyS" color={colors.sub} style={{ width: 72, paddingTop: 10 }}>{TAG_KIND_LABELS[kind]}</T>
      <View style={[s.wrap, { flex: 1 }]}>
        {tags.filter((t) => t.kind === kind && t.status !== 'rejected').map(tagChip)}
        <TagAdd kind={kind} tags={allTags} onAdded={(t) => repos.words.addTag(e.id, t.id)} />
      </View>
    </View>
  );

  // 似た言葉：補った言い換えのうち拾ってあるもの、同じ使う場面のタグ（確かめたもの）を持つ表現
  const similarCollected = new Map(e.similar.map((w) => [w, all.find((x) => x.normalized_key === normalizedKey(w))]));
  const myScenes = new Set(tags.filter((t) => t.kind === 'situation' && t.status === 'confirmed').map((t) => t.tag_id));
  const sameScene = myScenes.size === 0 ? [] : all.filter((x) => x.id !== e.id
    && links.some((l) => l.expression_id === x.id && l.status === 'confirmed' && myScenes.has(l.tag_id))).slice(0, 5);
  const enriched = e.meaning || e.nuance || e.similar.length > 0;
  const showSeal = e.stage === 'used' || played === 'seal';

  return (
    <Screen testID="word-screen" footer={notice ? <Notice message={notice} testID="word-notice" /> : undefined}>
      <View style={s.top}>
        <IconButton name="back" label="戻る" onPress={() => router.back()} style={{ marginLeft: -space.m }} />
        <View style={{ flex: 1 }} />
        <IconButton name={e.star ? 'star' : 'starOutline'} label={e.star ? '★を外す' : '★を付ける'} onPress={() => repos.words.setStar(e.id, !e.star)} testID="word-star" />
        <IconButton name="moreV" label="そのほかの操作" onPress={() => setMenu(true)} style={{ marginRight: -space.m }} testID="word-menu" />
      </View>

      <View style={{ paddingTop: space.s }}>
        {e.place === 'hand' && <Bookmark play={played === 'bookmark'} style={{ top: space.s, right: 0 }} />}
        <T variant="wordXL" testID="word-text" style={{ paddingRight: space.xxl }}>{e.text}</T>
        {e.reading !== '' && <T variant="bodyS" color={colors.sub}>{e.reading}</T>}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, marginTop: space.s }}>
          <T variant="bodyS" color={colors.sub} style={{ flex: 1 }} testID="word-meta">
            {[PLACE_LABELS[e.place], e.stage && e.place === 'hand' ? STAGE_LABELS[e.stage] : null, formatMonthDay(jstDate(new Date(e.created_at))),
              `${encounters.length} 回出会った`].filter(Boolean).join(' · ')}
          </T>
          {showSeal && <Seal play={played === 'seal'} />}
        </View>
        {e.place === 'hand' && e.due_on && (
          <T variant="label" color={colors.sub} style={{ marginTop: space.xs }} testID="word-due">次に聞くころ {formatMonthDay(e.due_on)}（{e.interval_days}日ごと）</T>
        )}
      </View>

      {edit && (
        <View style={{ marginTop: space.l }} testID="word-edit">
          <Field label="ことば" value={edit.text} onChangeText={(v) => setEdit({ ...edit, text: v })} mincho maxLength={200} testID="edit-text" />
          <Field label="読み" value={edit.reading} onChangeText={(v) => setEdit({ ...edit, reading: v })} maxLength={100} testID="edit-reading" />
          <Field label="場面" value={edit.scene} onChangeText={(v) => setEdit({ ...edit, scene: v })} maxLength={300} multiline testID="edit-scene" />
          <Field label="こういう時に使えそう" value={edit.use_note} onChangeText={(v) => setEdit({ ...edit, use_note: v })} maxLength={300} />
          <Field label="メモ" value={edit.note} onChangeText={(v) => setEdit({ ...edit, note: v })} maxLength={1000} multiline />
          <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.m }}>
            <Button label="やめる" variant="plain" small onPress={() => setEdit(null)} style={{ flex: 1 }} />
            <Button label="保存" small onPress={saveEdit} style={{ flex: 1 }} testID="edit-save" />
          </View>
        </View>
      )}

      {!edit && (e.use_note !== '' || e.note !== '') && (
        <View style={{ marginTop: space.l, gap: space.xs }}>
          {e.use_note !== '' && <T variant="bodyS"><T variant="bodyS" color={colors.sub}>こういう時に　</T>{e.use_note}</T>}
          {e.note !== '' && <T variant="bodyS"><T variant="bodyS" color={colors.sub}>メモ　</T>{e.note}</T>}
        </View>
      )}

      <SectionTitle title="出どころ" />
      {first && (
        <T variant="label" color={colors.sub}>
          {[first.captured_via === 'mcp' ? 'Claude から' : null, sourceName(first.source_id), first.title ? `『${first.title}』` : null, first.locator || null]
            .filter(Boolean).join(' · ')}
        </T>
      )}
      {e.scene !== '' && <T variant="body" color={colors.sub} style={{ marginTop: space.s }} testID="word-scene">{e.scene}</T>}
      {cloze && clozeEnc && (
        <T variant="wordS" style={{ marginTop: space.m, fontSize: 20, lineHeight: 34 }}>
          {cloze.before}<T variant="wordS" color={colors.accent} style={{ fontSize: 20, lineHeight: 34, textDecorationLine: 'underline' }}>{cloze.answer}</T>{cloze.after}
        </T>
      )}
      {!first && e.scene === '' && <T variant="bodyS" color={colors.sub}>まだありません</T>}

      {enriched && (
        <>
          <SectionTitle title="意味とニュアンス" right={<T variant="label" color={colors.sub}>Claude が補った{e.enriched_at ? ` · ${formatMonthDay(jstDate(new Date(e.enriched_at)))}` : ''}</T>} />
          {e.meaning !== '' && <T variant="body" testID="word-meaning">{e.meaning}</T>}
          {e.nuance !== '' && <T variant="bodyS" color={colors.sub} style={{ marginTop: space.s }}>{e.nuance}</T>}
          {e.similar.length > 0 && (
            <View style={[s.tagRow, { marginTop: space.m }]}>
              <T variant="bodyS" color={colors.sub} style={{ width: 72 }}>似た言葉</T>
              <View style={[s.wrap, { flex: 1, gap: space.l }]}>
                {e.similar.map((w) => {
                  const hit = similarCollected.get(w);
                  return hit
                    ? <Pressable key={w} accessibilityRole="link" onPress={() => router.push(`/word/${hit.id}`)}><T variant="bodyS" color={colors.accent} style={{ textDecorationLine: 'underline' }}>{w}</T></Pressable>
                    : <T key={w} variant="bodyS">{w}</T>;
                })}
              </View>
            </View>
          )}
        </>
      )}

      <SectionTitle title="例文" right={examples.length > 0 ? <Button label={editExamples ? '完了' : '編集'} variant="text" small onPress={() => setEditExamples((v) => !v)} testID="examples-edit" /> : undefined} />
      {examples.map((x) => {
        const proposed = x.origin === 'claude' && !x.confirmed;
        const who = x.origin === 'user' ? '自分' : proposed ? 'Claude の案。押すと確かめる' : 'Claude（確かめた）';
        return (
          <View key={x.text} style={[s.example, proposed && s.exampleProposed]} testID="example-row">
            <Pressable accessibilityRole={proposed ? 'button' : 'text'} accessibilityLabel={`${x.text}、${who}`} style={{ flex: 1, gap: 2 }}
              onPress={proposed ? () => repos.words.confirmExample(e.id, x.text) : undefined} disabled={!proposed}>
              <T variant="wordS">{x.text}</T>
              <T variant="caption" color={colors.sub}>{x.origin === 'user' ? '自分' : proposed ? 'Claude の案（タップで確かめる）' : 'Claude'}</T>
            </Pressable>
            {editExamples && <IconButton name="close" label={`${x.text}を外す`} size={18} color={colors.sub} onPress={() => repos.words.removeExample(e.id, x.text)} />}
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <TextInput
          value={newExample} onChangeText={setNewExample} placeholder="例文を足す" placeholderTextColor={colors.faint} maxLength={200}
          accessibilityLabel="例文を足す" style={s.exampleInput} testID="example-input"
          onSubmitEditing={() => { if (newExample.trim()) { void repos.words.addExample(e.id, newExample); setNewExample(''); } }}
        />
        {newExample.trim() !== '' && (
          <Button label="足す" variant="text" small onPress={() => { void repos.words.addExample(e.id, newExample); setNewExample(''); }} testID="example-save" />
        )}
      </View>

      <SectionTitle title="探すときの手がかり" right={<Button label={editTags ? '完了' : '編集'} variant="text" small onPress={() => setEditTags((v) => !v)} testID="tags-edit" />} />
      {tagRow('situation')}
      {tagRow('feeling')}
      <View style={s.tagRow}>
        <T variant="bodyS" color={colors.sub} style={{ width: 72, paddingTop: 10 }}>硬さ</T>
        <View style={[s.wrap, { flex: 1 }]}>
          {REGISTERS.map((r: Register) => (
            <Chip key={r} label={REGISTER_LABELS[r]} variant={e.register === r ? 'selected' : 'default'}
              onPress={() => repos.words.setRegister(e.id, e.register === r ? null : r)} testID={`register-${r}`} />
          ))}
        </View>
      </View>
      {e.register && <T variant="caption" color={colors.sub}>{e.register_by === 'claude' ? 'Claude が決めた硬さ（選ぶと自分で決めたことになります）' : '自分で決めた硬さ'}</T>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.m }}>
        <View style={{ width: 28, height: 16, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.sub }} />
        <T variant="caption" color={colors.sub}>Claude の案。タップで確かめると実線になります</T>
      </View>

      {sameScene.length > 0 && (
        <>
          <SectionTitle title="似た言葉" />
          <View style={[s.wrap, { gap: space.l }]}>
            {sameScene.map((x) => (
              <Pressable key={x.id} accessibilityRole="link" onPress={() => router.push(`/word/${x.id}`)}>
                <T variant="wordS" color={colors.accent} style={{ textDecorationLine: 'underline' }}>{x.text}</T>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <SectionTitle title="また出会った" />
      {encounters.map((x) => (
        <Pressable key={x.id} accessibilityRole="button" accessibilityLabel={`出会った場所を編集：${x.title || sourceName(x.source_id) || ''}`}
          onPress={() => router.push(`/encounter/${x.id}`)} style={s.encounter} testID="encounter-row">
          <T variant="bodyS" color={colors.sub} style={{ width: 88 }}>{x.met_on ? formatMonthDay(x.met_on) : formatMonthDay(jstDate(new Date(x.created_at)))}</T>
          <T variant="bodyS" style={{ flex: 1 }} numberOfLines={2}>
            {[x.captured_via === 'mcp' ? 'Claude から' : null, sourceName(x.source_id), x.title ? `『${x.title}』` : null, x.time_hint || null].filter(Boolean).join(' · ') || '場所なし'}
          </T>
          <Icon name="chevronRight" size={18} color={colors.sub} />
        </Pressable>
      ))}

      <View style={{ marginTop: space.xxl, gap: space.s }}>
        {e.place === 'collected' && (
          <>
            <Button label="手札に入れる" onPress={() => move('hand')} testID="to-hand" disabled={handCount >= HAND_LIMIT} />
            <T variant="label" color={colors.sub} style={{ textAlign: 'center' }}>
              {handCount >= HAND_LIMIT ? `手札は ${handCount} / ${HAND_LIMIT}。1枚戻すと入ります` : `手札は ${handCount} / ${HAND_LIMIT}。あと ${HAND_LIMIT - handCount} 枚入ります`}
            </T>
          </>
        )}
        {e.place === 'hand' && (
          <>
            <Button label="使えた" onPress={used} testID="used" />
            {ownReady(useDays) && <Button label="自分の言葉にする" variant="outline" onPress={() => move('own')} testID="to-own" />}
            <Button label="拾ったに戻す" variant="plain" onPress={() => move('collected')} testID="to-collected" />
          </>
        )}
        {e.place === 'own' && (
          <>
            <Button label="使えた" variant="outline" onPress={used} testID="used" />
            <Button label="もう一度練習する" variant="outline" onPress={() => move('hand')} testID="to-hand" />
            <Button label="拾ったに戻す" variant="plain" onPress={() => move('collected')} testID="to-collected" />
          </>
        )}
      </View>

      <Sheet visible={menu} onClose={() => setMenu(false)} testID="word-menu-sheet">
        <View style={{ gap: space.s }}>
          <Button label="書き直す" variant="plain" onPress={() => { setMenu(false); setEdit({ text: e.text, reading: e.reading, scene: e.scene, use_note: e.use_note, note: e.note }); }} testID="menu-edit" />
          <Button label="消す" variant="plain" onPress={() => { setMenu(false); setConfirmDelete(true); }} testID="menu-delete" />
        </View>
      </Sheet>
      <ConfirmDialog
        visible={confirmDelete}
        title={`「${e.text}」を消しますか？`}
        message="出会いと使えたの記録も一緒に消えます。手札から外したいだけなら、拾ったに戻してください。"
        confirmLabel="消す"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH + space.l, paddingTop: space.l },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  tagRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.m, marginBottom: space.m },
  encounter: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 48 },
  example: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.s, paddingLeft: space.m, borderLeftWidth: 2, borderLeftColor: colors.ink, marginBottom: space.s },
  exampleProposed: { borderLeftColor: colors.sub, borderStyle: 'dashed', borderLeftWidth: 2 },
  exampleInput: { flex: 1, fontFamily: fonts.mincho, fontSize: 17, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.line, minHeight: 44 },
});
