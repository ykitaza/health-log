import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AiCaptureButton } from '@/components/ChatSheet';
import { Icon } from '@/components/Icon';
import { SourceChips } from '@/components/SourceChips';
import { TagAdd } from '@/components/TagAdd';
import { Button, Chip, Field, Notice, T, Toggle } from '@/components/ui';
import type { CaptureResult } from '@/db/repositories/words';
import { SEED_SOURCE_IDS } from '@/db/seed';
import { useData, useRepos } from '@/hooks/data';
import { useNotifications } from '@/hooks/notifications';
import type { Expression, Tag, TagKind } from '@/lib/types';
import { colors, fonts, space } from '@/theme';

/** 保存したあとの一言 */
function captureMessage(r: CaptureResult, wantToUse: boolean): string {
  if (r.outcome === 'promoted') return 'また出会ったので、手札に入れました';
  if (r.outcome === 'reencountered') return r.handFull ? 'また出会いました（手札がいっぱいなので入れていません）' : 'また出会った、として足しました';
  if (wantToUse && r.handFull) return '手札がいっぱいなので、拾ったに入れました';
  return r.place === 'hand' ? '拾って、手札に入れました' : '拾いました';
}

/**
 * 書き留める欄（Figma のホーム・1-capture・1d。ホームの一番上）。1 行のことばの欄と、右に小さな「AI で拾う」。
 * ことばの欄に書き始めると「拾う」と、どこで・題・場面・例文・使いたい・たたんだ「探すときの手がかり」が開く。
 * 保存したあとも開いたまま（場所と題を残して、続けて拾える）。onSaved は保存した表現の ID（さっき拾ったの墨のにじみ）
 */
export function CaptureForm({ onSaved }: { onSaved?: (id: string) => void }) {
  const repos = useRepos();
  const notifications = useNotifications();
  const { data } = useData(async (r) => ({
    sources: await r.catalog.sources(), tags: await r.catalog.tags(), lastTitle: await r.words.lastTitle(),
  }));
  const sources = data?.sources ?? [];
  const tags = data?.tags ?? [];
  const [sourceId, setSourceId] = useState<string | null | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [scene, setScene] = useState('');
  const [useNote, setUseNote] = useState('');
  const [examples, setExamples] = useState<string[]>(['']);
  const [hints, setHints] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [wantToUse, setWantToUse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // 画面を離れたとき、ことばの欄が空なら欄をたたむ（タブの画面は残るので、ホームが長いままにならないように）
  const textRef = useRef(text);
  useEffect(() => { textRef.current = text; }, [text]);
  useFocusEffect(useCallback(() => () => { if (!textRef.current.trim()) setOpen(false); }, []));
  const [matches, setMatches] = useState<{ same: Expression | null; similar: Expression[] }>({ same: null, similar: [] });

  // 初めは、並びの最初の場所を選んでおく
  const selected = sourceId === undefined ? sources.find((s) => !s.hidden)?.id ?? null : sourceId;

  // 入力中に、同じ・似た表現を探す（少し待ってから）
  useEffect(() => {
    if (!text.trim()) { setMatches({ same: null, similar: [] }); return; }
    const t = setTimeout(() => { repos.words.matches(text).then(setMatches).catch(() => {}); }, 250);
    return () => clearTimeout(t);
  }, [text, repos]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const toggleTag = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const input = () => ({
    text, sourceId: selected, title, scene, useNote, tagIds: [...picked], wantToUse, examples: examples.filter((x) => x.trim() !== ''),
  });

  const done = async (r: CaptureResult) => {
    setNotice(captureMessage(r, wantToUse));
    onSaved?.(r.id);
    setText('');
    setScene('');
    setUseNote('');
    setExamples(['']);
    setPicked(new Set());
    setWantToUse(false);
    if (r.place === 'hand') await notifications.askOnce();
  };

  const capture = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await done(await repos.words.capture(input()));
    } catch {
      setNotice('拾えませんでした。もう一度押してください');
    } finally {
      setBusy(false);
    }
  };

  const again = async (id: string) => {
    setBusy(true);
    try {
      await done(await repos.words.reencounter(id, input()));
    } finally {
      setBusy(false);
    }
  };

  const chips = (kind: TagKind) => {
    const list = tags.filter((t) => t.kind === kind && (!t.hidden || picked.has(t.id)));
    return (
      <View style={s.wrap}>
        {list.map((t: Tag) => (
          <Chip key={t.id} label={t.name} variant={picked.has(t.id) ? 'selected' : 'default'} onPress={() => toggleTag(t.id)} testID={`hint-${t.name}`} />
        ))}
        <TagAdd kind={kind} tags={tags} onAdded={(t) => setPicked((p) => new Set(p).add(t.id))} />
      </View>
    );
  };

  const seedName = selected && SEED_SOURCE_IDS.has(selected) ? sources.find((x) => x.id === selected)?.name ?? null : null;
  return (
    <View testID="capture-form">
      <T variant="label" color={colors.accent}>書き留める</T>
      <View style={s.lineRow}>
        <TextInput
          value={text} onChangeText={(v) => { setText(v); if (v.trim()) setOpen(true); }}
          placeholder="出会った言葉" placeholderTextColor={colors.faint}
          accessibilityLabel="ことば" style={s.word} maxLength={200} testID="capture-text"
        />
        <AiCaptureButton small prompt={() => ({ kind: 'capture', seedSource: seedName, wantToUse })} />
      </View>

      {open && (
        <>
          <View style={{ marginTop: space.l }}>
            <SourceChips sources={sources} selected={selected} onSelect={setSourceId} />
          </View>

          <View style={s.titleRow}>
            <View style={{ flex: 1, gap: space.xs }}>
              <T variant="label" color={colors.sub}>本・作品</T>
              <TextInput
                value={title} onChangeText={setTitle} placeholder="題・人・場（なくてもよい）" placeholderTextColor={colors.faint}
                accessibilityLabel="本・作品" style={s.titleInput} maxLength={200} testID="capture-title"
              />
            </View>
            {data?.lastTitle && title !== data.lastTitle && (
              <Pressable accessibilityRole="button" accessibilityLabel="前回と同じ題にする" onPress={() => setTitle(data.lastTitle ?? '')} style={s.same}>
                <T variant="label" color={colors.sub}>前回と同じ</T>
                <Icon name="chevronRight" size={18} color={colors.sub} />
              </Pressable>
            )}
          </View>

          {(matches.same || matches.similar.length > 0) && (
            <View style={s.matches} testID="capture-matches">
              {[...(matches.same ? [matches.same] : []), ...matches.similar].map((m) => (
                <View key={m.id} style={s.matchRow}>
                  <View style={{ flex: 1 }}>
                    <T variant="label" color={colors.sub}>{m.id === matches.same?.id ? '同じ表現があります' : '似た表現があります'}</T>
                    <T variant="wordS">{m.text}</T>
                  </View>
                  <Button label="また出会った" variant="text" small onPress={() => again(m.id)} testID={`again-${m.text}`} />
                </View>
              ))}
            </View>
          )}

          <Field label="なぜ残したい？（なくてもよい）" value={scene} onChangeText={setScene} placeholder="場面・感じたこと" maxLength={300} testID="capture-scene" />

          <View style={s.examples} testID="capture-examples">
            <T variant="label" color={colors.sub}>例文（なくてもよい）</T>
            {examples.map((x, i) => (
              <TextInput
                key={i} value={x} onChangeText={(v) => setExamples((list) => list.map((y, j) => (j === i ? v : y)))}
                placeholder={i === 0 ? '自分ならこう言う、という一文' : 'もう一つ'} placeholderTextColor={colors.faint} maxLength={200}
                accessibilityLabel={`例文 ${i + 1}`} style={s.example} testID={`capture-example-${i}`} multiline
              />
            ))}
            {examples.length < 5 && examples[examples.length - 1].trim() !== '' && (
              <Pressable accessibilityRole="button" accessibilityLabel="例文をもう一つ足す" onPress={() => setExamples((l) => [...l, ''])} style={s.addExample} testID="capture-example-add">
                <Icon name="plus" size={18} color={colors.accent} />
                <T variant="bodyS" color={colors.accent}>例文を足す</T>
              </Pressable>
            )}
          </View>

          <View style={s.toggleRow}>
            <View style={{ flex: 1 }}>
              <T variant="body">使いたい</T>
              <T variant="label" color={colors.sub}>手札に入れて、聞くに出します</T>
            </View>
            <Toggle value={wantToUse} onChange={setWantToUse} label="使いたい" testID="capture-want" />
          </View>

          <Pressable accessibilityRole="button" accessibilityState={{ expanded: hints }} accessibilityLabel="探すときの手がかり（あとでも可）"
            onPress={() => setHints((v) => !v)} style={s.hintsHead} testID="capture-hints">
            <T variant="body" bold>探すときの手がかり</T>
            <T variant="label" color={colors.sub}>あとでも可</T>
            <View style={{ flex: 1 }} />
            <Icon name={hints ? 'chevronUp' : 'chevronDown'} size={22} color={colors.sub} />
          </Pressable>
          {hints && (
            <View style={{ gap: space.m, paddingBottom: space.l, borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <T variant="label" color={colors.sub}>使う場面</T>
              {chips('situation')}
              <T variant="label" color={colors.sub} style={{ marginTop: space.s }}>気持ち</T>
              {chips('feeling')}
              <Field label="こういう時に使えそう" value={useNote} onChangeText={setUseNote} placeholder="例：大きな仕事を終えた人に" maxLength={300} testID="capture-use-note" />
              <T variant="caption" color={colors.sub}>どれもなくて大丈夫。あとで Claude が案を出します</T>
            </View>
          )}
        </>
      )}

      {open && text.trim() !== '' && (
        <View style={{ gap: space.m, marginTop: space.xl }}>
          <Button label="拾う" onPress={capture} busy={busy} testID="capture-save" />
          <T variant="bodyS" color={colors.sub} style={{ textAlign: 'center' }}>話す・ページを撮る・ハイライトを共有、どれでも拾えます</T>
        </View>
      )}
      <Notice message={notice} testID="capture-notice" />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: space.m, marginTop: space.s, gap: space.s },
  titleInput: { fontFamily: fonts.sans, fontSize: 17, color: colors.ink, minHeight: 36 },
  same: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  word: { flex: 1, minWidth: 0, width: 0, fontFamily: fonts.mincho, fontSize: 24, lineHeight: 34, color: colors.ink, borderBottomWidth: 2, borderBottomColor: colors.accent, paddingVertical: space.xs, minHeight: 44 },
  matches: { marginTop: space.m, gap: space.s },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: space.l, paddingVertical: space.s, borderWidth: 1, borderColor: colors.line },
  examples: { gap: space.xs, paddingVertical: space.m, borderBottomWidth: 1, borderBottomColor: colors.line },
  example: { fontFamily: fonts.mincho, fontSize: 18, lineHeight: 28, color: colors.ink, minHeight: 40, paddingVertical: space.xs },
  addExample: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 44 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingVertical: space.m, borderBottomWidth: 1, borderBottomColor: colors.line },
  hintsHead: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.line },
});
