// ホームのヒーローの体の札（3D の体と 2D の図）：色の見方（回復・部位の量）に合わせて、「気にしたい部位」だけに札を付ける。
// 回復：まだ回復中の部位（あと何日が長い順）。部位の量：1 週間 10〜20 セットの目安から外れた部位（外れ方が大きい順）。
// 札は多くても 3 つ（小さな体を札でふさがない）。なにもなければ札なし（色だけで足りる。数字はカードに出る）。
// 体の部位を押すと、気にしたい部位でなくても、その部位の札を出す。選び方だけをここに置く（jest で確かめる。画面は components/HomeHero.tsx）
import { balanceAxisOf } from './partBalance';
import { gapText, perWeekText, PhaseVolume } from './partVolume';
import { PartRecovery, recoveryMeshesFor, recoveryShortText } from './recoveryMap';

/** 体の札に出す数（気にしたい部位。押した部位はこれに足す） */
export const HERO_TAG_MAX = 3;

/** 札：lead は部位、main・sub は 2 行の中身（sub は空もある）、spoken は 1 行の言い方（「脚 あと2日」「腹 週0（あと10）」） */
export type HeroTag = { key: string; part: string; lead: string; main: string; sub: string; spoken: string };

/** 札にできる部位。need は気にしたい度合い（大きいほど先。気にしなくていい部位は null） */
export type TagCandidate = { tag: HeroTag; need: number | null };

/** 回復の札の候補：どの部位も 1 つ（押したときのため）。気にしたいのは回復中の部位で、あと何日かが need */
export function recoveryCandidates(list: PartRecovery[]): TagCandidate[] {
  return list.map((p) => {
    const text = recoveryShortText(p);
    return { tag: { key: p.name, part: p.name, lead: p.name, main: text, sub: '', spoken: `${p.name} ${text}` }, need: p.remaining };
  });
}

/** 部位の量の札の候補：6 軸。気にしたいのは目安（10〜20）から外れた軸で、外れた分（足りない・多い）が need */
export function volumeCandidates(v: PhaseVolume): TagCandidate[] {
  return v.parts.map((p) => {
    const gap = p.short > 0 ? `あと${gapText(p.short)}` : p.over > 0 ? '多い' : '目安内';
    const week = `週${perWeekText(p.perWeek)}`;
    const need = p.short > 0 ? p.short : p.over > 0 ? p.over : null;
    return { tag: { key: p.part, part: p.part, lead: p.part, main: week, sub: gap, spoken: `${p.part} ${week}（${gap}）` }, need };
  });
}

/**
 * 出す札：気にしたい部位を need の大きい順に cap まで（同じなら候補の並び）。picked（押した部位）が入っていなければ、最後に足す。
 * 気にしたい部位がなく、押してもいなければ空
 */
export function selectHeroTags(cands: TagCandidate[], picked: string | null, cap: number = HERO_TAG_MAX): HeroTag[] {
  const attention = cands.map((c, i) => ({ c, i })).filter(({ c }) => c.need != null && c.need > 0)
    .sort((a, b) => b.c.need! - a.c.need! || a.i - b.i)
    .slice(0, cap)
    .map(({ c }) => c.tag);
  const extra = picked != null && !attention.some((t) => t.key === picked) ? cands.find((c) => c.tag.key === picked)?.tag : undefined;
  return extra ? [...attention, extra] : attention;
}

/** 3D の体で押した部品にあたる候補（並びのまま、最初の 1 つ）。どれにもなければ null */
export function pickByMesh(cands: TagCandidate[], mesh: string | null): string | null {
  if (mesh == null) return null;
  return cands.find((c) => recoveryMeshesFor(c.tag.part).includes(mesh))?.tag.key ?? null;
}

/**
 * 2D の図で押した点のまわりの部位の名前（lib/muscleFigure.ts の partsAt）にあたる候補（最初の 1 つ）。
 * 部位の量の候補は 6 軸なので、名前（上腕二頭筋など）が属する軸でも引く
 */
export function pickByNames(cands: TagCandidate[], names: string[]): string | null {
  const trimmed = names.map((n) => n.trim());
  const axes = new Set<string>(trimmed.flatMap((n) => balanceAxisOf(n) ?? []));
  return cands.find((c) => trimmed.includes(c.tag.part) || axes.has(c.tag.part))?.tag.key ?? null;
}
