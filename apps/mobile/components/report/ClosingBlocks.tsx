// レポート詳細の締めのブロック（モックの NEXT STEP・NEXT FOCUS・MONTHLY TASK）と、モックにない既存の中身（つながり・目標の見直し・本文。たたんで下に置く）。
// チェックの仕組みは既存のまま（components/WeeklyTodo の useTodoChecks。next_steps_done を書く）。ここは見た目だけ
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { AREA_LABELS, Block, linkCaption, parseMarkdown, ReportLink, ReportReview, Span } from '@/lib/reports';
import { T } from '../Text';
import { hud, JaVal, Micro, Mono, NotchChip, Panel, PanelHead, StatusRow, TableHead } from './hud';

/**
 * チェックできる次の一歩（日＝明日の一歩、週＝来週の焦点）。押せる大きさ 44 の四角の箱（チェックでミントの塗りに ✓）と、太い文。
 * streak があれば、下に等幅の緑で連続を出す
 */
export function CheckSteps({ en, title, steps, done, onToggle, streak, testID }: {
  en: string; title: string; steps: string[]; done: number[]; onToggle: (i: number) => void; streak?: string | null; testID: string;
}) {
  return (
    <Panel style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
      <PanelHead en={en} title={title} />
      <View testID={testID}>
        {steps.map((step, i) => {
          const checked = done.includes(i);
          return (
            <Pressable
              key={i}
              accessibilityRole="checkbox"
              aria-checked={checked}
              accessibilityState={{ checked }}
              accessibilityLabel={step}
              onPress={() => onToggle(i)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, paddingVertical: 4 }}
              testID={`todo-${i}`}
            >
              <NotchChip fill={checked ? hud.green : hud.panel2} border={checked ? undefined : hud.line} style={{ width: 44, height: 44 }}>
                {checked && (
                  <Svg width={22} height={22} viewBox="0 0 24 24">
                    <Path d="M4 12.5 L9.5 18 L20 6.5" stroke={hud.onGreen} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </Svg>
                )}
              </NotchChip>
              <View style={{ flex: 1 }}>
                <T bold size={15.5} color={checked ? hud.muted : hud.ink} style={[{ lineHeight: 23 }, checked && { textDecorationLine: 'line-through' }]}>{step}</T>
                <T size={11.5} color={hud.muted} style={{ marginTop: 2 }}>{checked ? '済み。もう一度押すと外せます' : 'できたらタップしてチェック'}</T>
              </View>
            </Pressable>
          );
        })}
      </View>
      {streak && <Mono size={11.5} color={hud.green} style={{ marginTop: 8, marginLeft: 56, fontWeight: '700' }} testID="report-daily-streak">{streak}</Mono>}
    </Panel>
  );
}

/** 月の課題（モックの MONTHLY TASK の表）。見るだけ */
export function MonthlyTaskBlock({ steps }: { steps: string[] }) {
  return (
    <Panel testID="report-monthly-task">
      <TableHead left="Monthly Task" right="This Month" />
      <View style={{ paddingHorizontal: 14, paddingTop: 2, paddingBottom: 6 }}>
        {steps.map((s, i) => (
          <StatusRow key={i} en={i === 0 ? 'Monthly Task' : `Task ${String(i + 1).padStart(2, '0')}`} ja={i === 0 ? '今月の課題' : `課題 ${i + 1}`}
            last={i === steps.length - 1} value={<JaVal>{s}</JaVal>} />
        ))}
      </View>
    </Panel>
  );
}

/** たたんだ中の小見出し（緑の英字＋和文） */
function SubHead({ en, title }: { en: string; title: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingTop: 10 }}>
      <Micro green>{en}</Micro>
      <T bold size={12.5} color={hud.label} accessibilityRole="header">{title}</T>
    </View>
  );
}

function Spans({ spans, size }: { spans: Span[]; size: number }) {
  return <>{spans.map((s, i) => (s.bold ? <T key={i} bold size={size} color={hud.ink}>{s.text}</T> : s.text))}</>;
}

function MarkdownBlock({ block }: { block: Block }) {
  if (block.type === 'heading') {
    return <T bold size={block.level <= 1 ? 15 : 14} color={hud.ink} selectable accessibilityRole="header"><Spans spans={block.spans} size={14} /></T>;
  }
  if (block.type === 'bullet') {
    return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <T size={13} color={hud.muted} style={{ minWidth: 12, lineHeight: 20 }}>{block.marker}</T>
        <T size={13} color={hud.note} selectable style={{ flex: 1, lineHeight: 20 }}><Spans spans={block.spans} size={13} /></T>
      </View>
    );
  }
  return <T size={13} color={hud.note} selectable style={{ lineHeight: 20 }}><Spans spans={block.spans} size={13} /></T>;
}

/** たたみの見出しの読み上げの名前（押すと開く・たたむ） */
export const MORE_LABEL = 'つながり・目標の見直し・本文';

/**
 * モックにない既存の中身を、DETAILS と同じ形でたたんで下に置く（初めはたたんである）：
 * つながり（AI が書いた、分野と分野の関係。「睡眠 → 筋トレ・2日」の補足と文）、目標の見直し（食事の目標のときだけ「食事の目標を開く」）、
 * 本文（Markdown。見出し・箇条書き・太字・段落だけを整え、ほかはすべて書かれた文字のまま。リンクは押せない。文字は選んでコピーできる）。
 * どれもなければ出さない
 */
export function MoreFold({ links, review, body }: { links: ReportLink[]; review: ReportReview | null; body: string }) {
  const [open, setOpen] = useState(false);
  const blocks = parseMarkdown(body);
  const parts = [links.length > 0 && 'つながり', review && '目標の見直し', blocks.length > 0 && '本文'].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return (
    <Panel testID="report-more">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={MORE_LABEL}
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Mono size={9} spacing={1.6} color={hud.microGreen} style={{ fontWeight: '700' }}>MORE</Mono>
          <T bold size={13.5} color={hud.ink} numberOfLines={1} style={{ flexShrink: 1 }}>{parts.join('・')}</T>
        </View>
        <T size={13} color={hud.green}>{open ? '▾' : '▸'}</T>
      </Pressable>
      {open && (
        <View style={{ borderTopWidth: 1, borderTopColor: hud.line2, paddingHorizontal: 14, paddingBottom: 10 }}>
          {links.length > 0 && (
            <>
              <SubHead en="Links" title="つながり" />
              {links.map((l, i) => (
                <View
                  key={i}
                  accessible
                  accessibilityLabel={`${AREA_LABELS[l.from]}から${AREA_LABELS[l.to]}へ${l.basis ? `（${l.basis}）` : ''}。${l.text}`}
                  style={{ paddingVertical: 8, borderBottomWidth: i === links.length - 1 ? 0 : 1, borderBottomColor: hud.rowLine }}
                >
                  <T bold size={11} color={hud.microGreen}>{linkCaption(l)}</T>
                  <T size={13} color={hud.note} style={{ marginTop: 3, lineHeight: 20 }}>{l.text}</T>
                </View>
              ))}
            </>
          )}
          {review && (
            <View testID="report-review">
              <SubHead en="Goal Review" title="目標の見直し" />
              <T size={13} color={hud.note} style={{ marginTop: 6, lineHeight: 20 }}>{review.text}</T>
              {review.target === 'meals_goal' && (
                <Pressable accessibilityRole="button" accessibilityLabel="食事の目標を開く" onPress={() => router.push('/meals/goal')}
                  style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
                  <T bold size={12} color={hud.green}>食事の目標を開く ›</T>
                </Pressable>
              )}
            </View>
          )}
          {blocks.length > 0 && (
            <>
              <SubHead en="Notes" title="くわしく" />
              <View style={{ gap: 8, marginTop: 8 }} testID="report-body">
                {blocks.map((b, i) => <MarkdownBlock key={i} block={b} />)}
              </View>
            </>
          )}
        </View>
      )}
    </Panel>
  );
}
