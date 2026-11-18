import { router } from 'expo-router';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Chip, IconButton, Screen, T } from '@/components/ui';
import { WordRow } from '@/components/WordRow';
import { useData, useRepos } from '@/hooks/data';
import { intentChatUrl } from '@/lib/chat';
import { rowSub } from '@/lib/collected';
import { reviewDay } from '@/lib/date';
import { applyFacets, EMPTY_FACETS, facetCount, Facets, periodOptions } from '@/lib/facets';
import { likePattern, queryTerms } from '@/lib/search';
import { Place, PLACE_LABELS, Register, REGISTER_LABELS, REGISTERS, TagStatus } from '@/lib/types';
import { colors, fonts, radius, space } from '@/theme';

type ListKey = 'situations' | 'feelings' | 'registers' | 'sources' | 'titles' | 'periods' | 'places';

/** 探す（Figma の 6-search・6b）。上に文字で探す欄、下に見て回り方と絞り込み。結果ではタグの確かめた・案を見分ける */
export default function SearchScreen() {
  const repos = useRepos();
  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [showFacets, setShowFacets] = useState(false);
  const [ids, setIds] = useState<Set<string> | null>(null);
  const { data } = useData(async (r) => ({
    items: await r.words.listAll(), links: await r.words.allTagLinks(), encounters: await r.words.encounterFacets(),
    tags: await r.catalog.tags(), sources: await r.catalog.sources(),
  }));

  // 文字は端末の SQLite で探す（search_key の LIKE の「かつ」）
  useEffect(() => {
    const terms = queryTerms(query);
    if (terms.length === 0) { setIds(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      repos.words.searchIds(terms.map(likePattern)).then((r) => { if (alive) setIds(new Set(r)); }).catch(() => {});
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [query, repos]);

  const today = reviewDay(new Date());
  const active = facetCount(facets) > 0 || ids != null;
  const results = useMemo(() => {
    if (!data) return [];
    const base = ids ? data.items.filter((e) => ids.has(e.id)) : data.items;
    return applyFacets(base, facets, data.links, data.encounters, today, query);
  }, [data, ids, facets, today, query]);

  const toggle = <K extends ListKey>(key: K, value: Facets[K][number]) => setFacets((f) => {
    const list = f[key] as string[];
    return { ...f, [key]: list.includes(value as string) ? list.filter((v) => v !== value) : [...list, value] };
  });

  const tags = data?.tags ?? [];
  const sources = data?.sources ?? [];
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? '';
  const sourceName = (id: string) => sources.find((s) => s.id === id)?.name ?? '';

  // 件数（場所・本）
  const counts = useMemo(() => {
    const bySource = new Map<string, Set<string>>();
    const byTitle = new Map<string, Set<string>>();
    for (const e of data?.encounters ?? []) {
      if (e.source_id) bySource.set(e.source_id, (bySource.get(e.source_id) ?? new Set()).add(e.expression_id));
      if (e.title) byTitle.set(e.title, (byTitle.get(e.title) ?? new Set()).add(e.expression_id));
    }
    return { bySource, byTitle };
  }, [data]);

  const conditions: { label: string; remove: () => void }[] = [
    ...facets.situations.map((id) => ({ label: `場面：${tagName(id)}`, remove: () => toggle('situations', id) })),
    ...facets.feelings.map((id) => ({ label: `気持ち：${tagName(id)}`, remove: () => toggle('feelings', id) })),
    ...facets.registers.map((r) => ({ label: `硬さ：${REGISTER_LABELS[r]}`, remove: () => toggle('registers', r) })),
    ...facets.sources.map((id) => ({ label: `場所：${sourceName(id)}`, remove: () => toggle('sources', id) })),
    ...facets.titles.map((t) => ({ label: `本・人：${t}`, remove: () => toggle('titles', t) })),
    ...facets.periods.map((p) => ({ label: `時期：${p === 'week' ? 'この1週間' : /^\d{4}$/.test(p) ? `${p}年` : `${Number(p.slice(5))}月`}`, remove: () => toggle('periods', p) })),
    ...facets.places.map((p) => ({ label: `置き場所：${PLACE_LABELS[p]}`, remove: () => toggle('places', p) })),
    ...(facets.starred ? [{ label: '★', remove: () => setFacets((f) => ({ ...f, starred: false })) }] : []),
  ];

  const facetPanel = (browse: boolean) => {
    const section = (title: string, chips: ReactNode) => (
      <View style={{ marginTop: space.xl, gap: space.m }}>
        <T variant="section">{title}</T>
        <View style={s.wrap}>{chips}</View>
      </View>
    );
    const sel = (key: ListKey, v: string) => (facets[key] as string[]).includes(v) ? 'selected' : 'default';
    const titles = [...counts.byTitle.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 8);
    return (
      <View testID="facets">
        {section('場面', tags.filter((t) => t.kind === 'situation' && !t.hidden).map((t) => (
          <Chip key={t.id} label={t.name} variant={sel('situations', t.id)} testID={`facet-${t.name}`}
            onPress={() => (browse ? router.push(`/collected/tag/${t.id}`) : toggle('situations', t.id))} />
        )))}
        {section('気持ち', tags.filter((t) => t.kind === 'feeling' && !t.hidden).map((t) => (
          <Chip key={t.id} label={t.name} variant={sel('feelings', t.id)} onPress={() => toggle('feelings', t.id)} testID={`facet-${t.name}`} />
        )))}
        {section('硬さ', REGISTERS.map((r: Register) => (
          <Chip key={r} label={REGISTER_LABELS[r]} variant={sel('registers', r)} onPress={() => toggle('registers', r)} testID={`facet-${REGISTER_LABELS[r]}`} />
        )))}
        {section('出会った場所・本', [
          ...titles.map(([t, set]) => (
            <Chip key={`t:${t}`} label={`『${t}』 ${set.size}`} variant={sel('titles', t)} onPress={() => toggle('titles', t)} />
          )),
          ...sources.filter((x) => counts.bySource.has(x.id)).map((x) => (
            <Chip key={x.id} label={`${x.name} ${counts.bySource.get(x.id)!.size}`} variant={sel('sources', x.id)} onPress={() => toggle('sources', x.id)} testID={`facet-source-${x.name}`} />
          )),
        ])}
        {section('時期', periodOptions((data?.items ?? []).map((e) => e.created_at), today).map((o) => (
          <Chip key={o.key} label={o.label} variant={sel('periods', o.key)} onPress={() => toggle('periods', o.key)} testID={`facet-period-${o.key}`} />
        )))}
        {section('置き場所', [
          ...(['hand', 'own', 'collected'] as Place[]).map((p) => (
            <Chip key={p} label={PLACE_LABELS[p]} variant={sel('places', p)} onPress={() => toggle('places', p)} />
          )),
          <Chip key="star" label="★" variant={facets.starred ? 'selected' : 'default'} onPress={() => setFacets((f) => ({ ...f, starred: !f.starred }))} />,
        ])}
      </View>
    );
  };

  /** 結果の3行目：タグ（Claude の案は「（Claude の案）」）と硬さ */
  const tagLine = (tagIds: Map<string, TagStatus>, register: Register | null) => {
    const confirmed = [...tagIds.entries()].filter(([, st]) => st === 'confirmed').map(([id]) => tagName(id)).filter(Boolean);
    const proposed = [...tagIds.entries()].filter(([, st]) => st === 'proposed').map(([id]) => tagName(id)).filter(Boolean);
    const parts = [...confirmed, ...(register ? [REGISTER_LABELS[register]] : [])].join(' · ');
    return [parts, proposed.length ? `${proposed.join(' · ')}（Claude の案）` : ''].filter(Boolean).join(' · ');
  };

  return (
    <Screen inTab testID="search-screen">
      <View style={s.top}>
        <IconButton name="back" label="戻る" onPress={() => router.back()} style={{ marginLeft: -space.m }} />
        <View style={s.box}>
          <Icon name="search" size={20} color={colors.sub} />
          <TextInput
            value={query} onChangeText={setQuery} placeholder="ことば・意味・場面で探す" placeholderTextColor={colors.faint}
            accessibilityLabel="ことば・意味・場面で探す" style={s.input} testID="search-input" returnKeyType="search"
          />
          {query !== '' && <IconButton name="close" label="消す" onPress={() => setQuery('')} size={18} />}
        </View>
      </View>

      {!active && (
        <>
          <Pressable
            accessibilityRole="link" accessibilityLabel="言いたいことから探す。Claude を開きます"
            onPress={() => { void Linking.openURL(intentChatUrl('claude')).catch(() => {}); }}
            style={({ pressed }) => [s.intent, pressed && { opacity: 0.7 }]}
            testID="search-intent"
          >
            <T variant="bodyS" bold color={colors.accent}>言いたいことから探す</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <T variant="wordS" style={{ flex: 1 }}>「落ち込んでる友達に、何て言おう」</T>
              <Icon name="external" size={20} color={colors.accent} />
            </View>
            <T variant="label" color={colors.sub}>Claude が、あなたの拾った言葉から選びます</T>
          </Pressable>
          {facetPanel(true)}
        </>
      )}

      {active && (
        <>
          <View style={[s.wrap, { marginTop: space.m }]}>
            {conditions.map((c) => <Chip key={c.label} label={c.label} variant="selected" onRemove={c.remove} accessibilityLabel={`${c.label}を外す`} />)}
            <Chip label="条件" icon="plus" onPress={() => setShowFacets((v) => !v)} testID="add-condition" />
          </View>
          {showFacets && facetPanel(false)}
          <T variant="label" color={colors.sub} style={{ marginTop: space.l }} testID="search-count">{results.length} 件</T>
          {results.map((e) => (
            <WordRow key={e.id} e={e} sub={rowSub(e)} extra={tagLine(e.tagIds, e.register)} testID="search-row" />
          ))}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingTop: space.l },
  box: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: colors.card, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, paddingLeft: space.l, minHeight: 52,
  },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 16, color: colors.ink, minHeight: 48 },
  intent: { marginTop: space.xl, backgroundColor: colors.card, borderRadius: radius.l, borderWidth: 1, borderColor: colors.line, padding: space.xl, gap: space.s },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
});
