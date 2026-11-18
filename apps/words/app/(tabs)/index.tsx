import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AiCaptureButton } from '@/components/ChatSheet';
import { Icon } from '@/components/Icon';
import { SourceChips } from '@/components/SourceChips';
import { TagAdd } from '@/components/TagAdd';
import { Button, Chip, Field, Header, Notice, Screen, T, Toggle } from '@/components/ui';
import { InkSettle } from '@/components/wa';
import type { CaptureResult, ListItem } from '@/db/repositories/words';
import { SEED_SOURCE_IDS } from '@/db/seed';
import { useData, useRepos } from '@/hooks/data';
import { useNotifications } from '@/hooks/notifications';
import { relativeTime } from '@/lib/date';
import type { Expression, Source, Tag, TagKind } from '@/lib/types';
import { colors, fonts, space } from '@/theme';

/** 保存したあとの一言 */
function captureMessage(r: CaptureResult, wantToUse: boolean): string {
  if (r.outcome === 'promoted') return 'また出会ったので、手札に入れました';
  if (r.outcome === 'reencountered') return r.handFull ? 'また出会いました（手札がいっぱいなので入れていません）' : 'また出会った、として足しました';
  if (wantToUse && r.handFull) return '手札がいっぱいなので、拾ったに入れました';
  return r.place === 'hand' ? '拾って、手札に入れました' : '拾いました';
}

/** さっき拾ったの横（「Audible・3分前」「Claude から・本の写真・昨日」） */
function recentMeta(e: ListItem, sources: Source[], now: Date) {
  const src = sources.find((s) => s.id === e.firstSourceId)?.name;
  return [e.firstVia === 'mcp' ? 'Claude から' : null, src, relativeTime(e.created_at, now)].filter(Boolean).join(' · ');
}

/** 書き留める（Figma の 1-capture・1d）。表現・どこで・題・場面、たたんだ「探すときの手がかり」、拾う、AI で拾う */
export default function CaptureScreen() {
  const repos = useRepos();
  const notifications = useNotifications();
  const { data } = useData(async (r) => ({
    sources: await r.catalog.sources(), tags: await r.catalog.tags(), recent: await r.words.recent(3), lastTitle: await r.words.lastTitle(),
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
  const [savedId, setSavedId] = useState<string | null>(null);
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
    setSavedId(r.id);
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
  const now = new Date();

  return (
    <Screen inTab testID="capture-screen">
      <Header title="書き留める" />
      <SourceChips sources={sources} selected={selected} onSelect={setSourceId} />

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

      <View style={{ marginTop: space.xl, gap: space.xs }}>
        <T variant="label" color={colors.accent}>ことば</T>
        <TextInput
          value={text} onChangeText={setText} placeholder="出会った言葉" placeholderTextColor={colors.faint}
          accessibilityLabel="ことば" style={s.word} maxLength={200} testID="capture-text" multiline
        />
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

      <View style={{ gap: space.m, marginTop: space.xl }}>
        <Button label="拾う" onPress={capture} disabled={!text.trim()} busy={busy} testID="capture-save" />
        <AiCaptureButton prompt={() => ({ kind: 'capture', seedSource: seedName, wantToUse })} />
        <T variant="bodyS" color={colors.sub} style={{ textAlign: 'center' }}>話す・ページを撮る・ハイライトを共有、どれでも拾えます</T>
      </View>
      <Notice message={notice} testID="capture-notice" />

      {(data?.recent.length ?? 0) > 0 && (
        <View style={{ marginTop: space.xxl, gap: space.s }}>
          <T variant="label" color={colors.sub}>さっき拾った</T>
          {data!.recent.map((e) => (
            <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={e.text} onPress={() => router.push(`/word/${e.id}`)} style={s.recent} testID="recent-row">
              <InkSettle play={e.id === savedId} style={{ flexShrink: 1 }}>
                <T variant="word">{e.text}</T>
              </InkSettle>
              <T variant="label" color={colors.sub} numberOfLines={1} style={{ flexShrink: 1 }}>{recentMeta(e, sources, now)}</T>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: space.m, marginTop: space.l, gap: space.s },
  titleInput: { fontFamily: fonts.sans, fontSize: 17, color: colors.ink, minHeight: 36 },
  same: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  word: { fontFamily: fonts.mincho, fontSize: 32, lineHeight: 46, color: colors.ink, borderBottomWidth: 2, borderBottomColor: colors.accent, paddingVertical: space.s, minHeight: 64 },
  matches: { marginTop: space.m, gap: space.s },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: space.l, paddingVertical: space.s, borderWidth: 1, borderColor: colors.line },
  examples: { gap: space.xs, paddingVertical: space.m, borderBottomWidth: 1, borderBottomColor: colors.line },
  example: { fontFamily: fonts.mincho, fontSize: 18, lineHeight: 28, color: colors.ink, minHeight: 40, paddingVertical: space.xs },
  addExample: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 44 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingVertical: space.m, borderBottomWidth: 1, borderBottomColor: colors.line },
  hintsHead: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.line },
  recent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.l, minHeight: 56 },
});
