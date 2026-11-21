// 食事を同じ日の別の区分へ移す（#328）。食事の画面で、記録を長押しで持ち上げて区分の上で離す・長押しのメニューの「〜へ移す」・読み上げの操作。
// ここには計算だけを置く（区分の受け皿を指の位置から選ぶ・画面の端の自動スクロール・文言）。集計（lib/meals.ts）には手を入れない
import { SLOT_LABELS, SLOTS, Slot } from './meals';

/** 区分の受け皿の位置（持ち上げたときに測った、画面の上からの位置。dp） */
export type SlotBox = { slot: Slot; top: number; bottom: number };

/** 長押しで持ち上げるまでの時間（ms）。Pressable の既定 500 より少し短く */
export const LIFT_DELAY_MS = 400;
/** 持ち上げたあと、離すまでにこれより動かさなければ、ドラッグでなくメニューを開く（dp） */
export const MENU_SLOP = 8;
/** 画面の上下のこの幅に指が入ったら、自動でスクロールする（dp） */
export const EDGE_ZONE = 72;
/** 自動スクロールの 1 コマの最大の量（dp）。端に近いほど速い */
export const EDGE_MAX_STEP = 14;
/** 移したあとの知らせ（元に戻す）を出しておく時間（ms） */
export const MOVED_NOTICE_MS = 6000;

/**
 * 指の下の区分（受け皿）。y は持ち上げたときの画面の位置に直した指の位置（今の指の位置 + 持ち上げてからスクロールした量）。
 * 今の区分の上や、どの区分の上でもないときは null（離しても移さない）
 */
export function dropSlot(y: number, boxes: SlotBox[], from: Slot): Slot | null {
  const hit = boxes.find((b) => y >= b.top && y < b.bottom);
  return hit && hit.slot !== from ? hit.slot : null;
}

/**
 * 画面の端の自動スクロールの 1 コマの量（上へは負）。y は今の指の位置、viewport は Screen のスクロールの見えている範囲。
 * 端の帯（EDGE_ZONE）の外なら 0
 */
export function edgeScrollStep(y: number, viewport: { top: number; height: number } | null): number {
  if (!viewport) return 0;
  const fromTop = y - viewport.top;
  const fromBottom = viewport.top + viewport.height - y;
  if (fromTop < EDGE_ZONE) return -Math.ceil(EDGE_MAX_STEP * (1 - Math.max(0, fromTop) / EDGE_ZONE));
  if (fromBottom < EDGE_ZONE) return Math.ceil(EDGE_MAX_STEP * (1 - Math.max(0, fromBottom) / EDGE_ZONE));
  return 0;
}

/** 移せる区分（今の区分のほかの 3 つ。朝・昼・夕・間食の順） */
export const moveTargets = (from: Slot): Slot[] => SLOTS.filter((s) => s !== from);

/** 「間食へ移す」（メニュー・読み上げの操作の名前） */
export const moveLabel = (to: Slot) => `${SLOT_LABELS[to]}へ移す`;

/** 移したあとの知らせ */
export const movedMessage = (title: string, to: Slot) => `「${title}」を${SLOT_LABELS[to]}へ移しました`;

/** 読み上げの操作の名前（accessibilityActions の name）と、それが指す区分 */
export const moveActionName = (to: Slot) => `move-${to}`;
export function slotOfAction(name: string): Slot | null {
  const slot = name.startsWith('move-') ? name.slice('move-'.length) : '';
  return (SLOTS as string[]).includes(slot) ? (slot as Slot) : null;
}

/**
 * 食事の行の読み上げの操作（TalkBack の操作の一覧）。開く（activate）と、今の区分のほかの 3 つへ「〜へ移す」。
 * ドラッグできない読み上げでも、ここから移せる
 */
export function rowActions(from: Slot): { name: string; label?: string }[] {
  return [{ name: 'activate' }, ...moveTargets(from).map((to) => ({ name: moveActionName(to), label: moveLabel(to) }))];
}
