// ホームのヒーローの体の札（3D の体と 2D の図）：色の見方（回復・部位の量）に合わせて、札を付ける。
// 回復：今日どこを鍛えるか決めるための、まだ回復中の部位（あと何日が長い順）。
// 部位の量：やる気のための、フェーズで多くやった部位（セット数の合計が多い順。同じなら 6 軸の並び。0 セットの部位は出さない）。
// 札は多くても 3 つ（小さな体を札でふさがない）。なにもなければ札なし（色だけで足りる）。
// 回復は、回復中の札のあとに、回復済みの部位の札（「回復済み」。からだのタブの回復マップと同じ言い方・同じ色の見方）を、全部で 4 つまで足す（回復中が先）。
// 体の部位を押すと、気にしたい部位でなくても、その部位の札を出す。選び方だけをここに置く（jest で確かめる。画面は components/HomeHero.tsx）
import { balanceAxisOf } from './partBalance';
import { PhaseVolume, setsText } from './partVolume';
import { PartRecovery, recoveryMeshesFor, recoveryShortText } from './recoveryMap';

/** 体の札に出す数（気にしたい部位。押した部位はこれに足す） */
export const HERO_TAG_MAX = 3;
/** 回復の札の全部の数（回復中は HERO_TAG_MAX まで、残りの 1 つに回復済み）。押した部位はこれに足す */
export const HERO_TAG_MAX_WITH_RECOVERED = 4;

/** 札：lead は部位、main・sub は 2 行の中身（sub は空もある）、spoken は 1 行の言い方（「脚 あと2日」「腹 週0（あと10）」） */
export type HeroTag = { key: string; part: string; lead: string; main: string; sub: string; spoken: string; stack?: boolean };

/** 札にできる部位。need は気にしたい度合い（大きいほど先。気にしなくていい部位は null） */
export type TagCandidate = { tag: HeroTag; need: number | null; /** 回復済みの部位だけ：最後に鍛えた日（新しいほど先に足す）。ほかは null か付けない */ settled?: string | null };

/** 回復の札の候補：どの部位も 1 つ（押したときのため）。気にしたいのは回復中の部位で、あと何日かが need */
export function recoveryCandidates(list: PartRecovery[]): TagCandidate[] {
  return list.map((p) => {
    const text = recoveryShortText(p);
    const recovered = p.last != null && p.remaining == null && !p.idle;
    return { tag: { key: p.name, part: p.name, lead: p.name, main: text, sub: '', spoken: `${p.name} ${text}`, stack: true }, need: p.remaining, settled: recovered ? p.last : null };
  });
}

/** 部位の量の札の候補：6 軸。多くやった部位が先なので、need はセット数の合計（0 セットは null で、押したときだけ札になる）。札は部位の名前と「23セット」の 2 行 */
export function volumeCandidates(v: PhaseVolume): TagCandidate[] {
  return v.parts.map((p) => {
    const sets = setsText(p.total);
    return { tag: { key: p.part, part: p.part, lead: p.part, main: sets, sub: '', spoken: `${p.part} ${sets}`, stack: true }, need: p.total > 0 ? p.total : null };
  });
}

/**
 * 出す札：気にしたい部位を need の大きい順に cap まで（同じなら候補の並び）。そのあとに回復済みの部位を、全部で total まで。picked（押した部位）が入っていなければ、最後に足す。
 * 気にしたい部位がなく、押してもいなければ空
 */
export function selectHeroTags(cands: TagCandidate[], picked: string | null, cap: number = HERO_TAG_MAX, total: number = cap): HeroTag[] {
  const attention = cands.map((c, i) => ({ c, i })).filter(({ c }) => c.need != null && c.need > 0)
    .sort((a, b) => b.c.need! - a.c.need! || a.i - b.i)
    .slice(0, cap)
    .map(({ c }) => c.tag);
  // 回復済み（settled）の部位：最後に鍛えた日の新しい順（同じなら候補の並び）に、全部で total まで
  const settled = cands.map((c, i) => ({ c, i })).filter(({ c }) => c.settled != null)
    .sort((a, b) => b.c.settled!.localeCompare(a.c.settled!) || a.i - b.i)
    .slice(0, Math.max(0, total - attention.length))
    .map(({ c }) => c.tag);
  attention.push(...settled);
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
