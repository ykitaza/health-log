// ケガの記録（docs/sync-design.md の「対象」の注。サーバーは services/training/training/domain/injury.py）。
// 筋トレで痛めたときに、どの場面で何が起きたか・原因の自己分析・次の直し方・その後の振り返りを残し、PDCA を回す。
// 原因と直し方は本人の言葉のまま。痛みの強さ・診断は扱わない
import type { Big3Role } from './exercises';
import { INJURY_LIMITS } from './limits';

export type SiteKind = 'muscle' | 'joint';

export type SiteInfo = {
  /** サーバーの SITES の名前（詳しい名前。画面では補足に出す） */
  name: string;
  kind: SiteKind;
  /** 左右があるか（あれば side で持つ） */
  sided: boolean;
  /** 画面の短い名前（「右肩」の「肩」） */
  short: string;
  /** 左右を前にそのまま付ける（「右肩」）。false なら「右の二頭筋」のように「の」を挟む */
  compound: boolean;
};

const site = (name: string, kind: SiteKind, sided: boolean, short: string, compound = true): SiteInfo => ({ name, kind, sided, short, compound });

/** 部位のコード（サーバーの SITES と同じ並び・名前。lib/__tests__/server-limits.test.ts で突き合わせる） */
export const SITES = {
  shoulder_front: site('三角筋（前）', 'muscle', true, '肩'),
  chest: site('胸', 'muscle', true, '胸'),
  biceps: site('上腕二頭筋', 'muscle', true, '二頭筋', false),
  forearm: site('前腕', 'muscle', true, '前腕', false),
  trapezius: site('僧帽筋', 'muscle', true, '僧帽筋', false),
  abs: site('腹筋', 'muscle', false, '腹筋'),
  obliques: site('腹斜筋', 'muscle', true, 'わき腹'),
  quads: site('大腿四頭筋', 'muscle', true, '太もも前'),
  shins: site('すね', 'muscle', true, 'すね'),
  shoulder_rear: site('三角筋（後ろ）', 'muscle', true, '肩の後ろ'),
  triceps: site('上腕三頭筋', 'muscle', true, '三頭筋', false),
  lats: site('広背筋', 'muscle', true, '広背筋', false),
  lower_back: site('脊柱起立筋（腰の筋肉）', 'muscle', false, '腰の筋肉'),
  glutes: site('お尻', 'muscle', true, 'お尻', false),
  hamstrings: site('ハムストリングス', 'muscle', true, 'もも裏'),
  calves: site('ふくらはぎ', 'muscle', true, 'ふくらはぎ', false),
  neck: site('首', 'joint', false, '首'),
  shoulder_joint: site('肩（関節）', 'joint', true, '肩の関節'),
  elbow: site('肘', 'joint', true, 'ひじ'),
  wrist: site('手首', 'joint', true, '手首'),
  waist: site('腰（関節・下背部）', 'joint', false, '腰'),
  hip: site('股関節', 'joint', true, '股関節'),
  knee: site('膝', 'joint', true, 'ひざ'),
  ankle: site('足首', 'joint', true, '足首'),
} as const satisfies Record<string, SiteInfo>;

export type SiteCode = keyof typeof SITES;
export const SITE_CODES = Object.keys(SITES) as SiteCode[];

export const isSiteCode = (v: unknown): v is SiteCode => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SITES, v);

export type Side = 'left' | 'right';
export type InjuryStatus = 'fixing' | 'fixed';
export type ReviewResult = 'fixed' | 'not_yet' | 'pain';

export const SIDE_NAMES: Record<Side, string> = { right: '右', left: '左' };
export const STATUS_NAMES: Record<InjuryStatus, string> = { fixing: '直している途中', fixed: '直せた' };

/** 振り返りの結果。記号を添えて、色だけにしない（✓直せた △まだ ！痛んだ） */
export const RESULTS: Record<ReviewResult, { label: string; mark: string }> = {
  fixed: { label: '直せた', mark: '✓' },
  not_yet: { label: 'まだ', mark: '△' },
  pain: { label: '痛んだ', mark: '！' },
};
export const RESULT_KEYS: ReviewResult[] = ['fixed', 'not_yet', 'pain'];

export const isSide = (v: unknown): v is Side => v === 'left' || v === 'right';
export const isReviewResult = (v: unknown): v is ReviewResult => v === 'fixed' || v === 'not_yet' || v === 'pain';

/** 部位に左右があるか。知らないコードは左右なしとして扱う */
export const isSided = (code: string) => isSiteCode(code) && SITES[code].sided;

/**
 * 画面の部位の名前（「右肩」「右の二頭筋」「腰」）。左右のない部位・左右の分からないものは部位の名前だけ。
 * 知らないコード（あとの版でサーバーに足したものなど）は「ほかの部位」
 */
export function siteLabel(code: string, side: string | null): string {
  if (!isSiteCode(code)) return 'ほかの部位';
  const s = SITES[code];
  if (!s.sided || !isSide(side)) return s.short;
  return s.compound ? `${SIDE_NAMES[side]}${s.short}` : `${SIDE_NAMES[side]}の${s.short}`;
}

/** 部位の詳しい名前（サーバーの名前。補足に出す）。知らないコードはコードのまま */
export function siteDetail(code: string): string {
  return isSiteCode(code) ? SITES[code].name : code;
}

/** 場面の候補（アプリで決め打ち。ほかに自由に書ける）。BIG3 はホームの BIG3 の割り当て（big3Assignments）で決める */
const PHASES: Record<Big3Role | 'other', string[]> = {
  bench: ['ラックアップ', '下ろす', '押し上げる', 'ラックに戻す'],
  squat: ['担ぐ', 'しゃがむ', '立ち上がる', 'ラックに戻す'],
  deadlift: ['引き始め', '引き上げる', '下ろす'],
  other: ['始める', '下ろす', '上げる', '戻す'],
};

export function phasesFor(role: Big3Role | null | undefined): string[] {
  return PHASES[role ?? 'other'];
}

/** 受け取ったケガの値を、画面で使える形にそろえる（MCP やあとの版が書いた値でも出せるように） */
export function normalizeInjury<T extends { site: string; side: string | null; status: string; fixedOn: string | null }>(i: T): T & {
  side: Side | null; status: InjuryStatus; fixedOn: string | null;
} {
  const status: InjuryStatus = i.status === 'fixed' ? 'fixed' : 'fixing';
  return {
    ...i,
    // 左右のない部位の左右は捨てる（サーバーの読む側と同じ）
    side: isSided(i.site) && isSide(i.side) ? i.side : null,
    status,
    // 直せた日は、直せたのときだけ使う（直せたで直せた日がないこともある）
    fixedOn: status === 'fixed' ? i.fixedOn : null,
  };
}

/** 文字の長さ（前後の空白を取ってから、コードポイントで数える。サーバーの Python の len と同じ） */
export const textLength = (text: string) => [...text.trim()].length;

export type InjuryInput = {
  occurredOn: string;
  site: string;
  side: Side | null;
  exerciseId: string | null;
  phase: string;
  symptom: string;
  cause: string;
  fix: string;
};

const TEXT_FIELDS: { key: 'phase' | 'symptom' | 'cause' | 'fix'; label: string }[] = [
  { key: 'phase', label: '場面' },
  { key: 'symptom', label: '何が起きたか' },
  { key: 'cause', label: '原因' },
  { key: 'fix', label: '次の直し方' },
];

/** 長すぎるときの文言。長すぎなければ null */
export function lengthError(label: string, text: string, max: number): string | null {
  const n = textLength(text);
  return n > max ? `${label}は${max}文字以内で入れてください（今は${n}文字）` : null;
}

/**
 * ケガの入力を確かめる。よければ null、だめなら文言。
 * fixedOn は、直せたにしたケガを直すとき（痛めた日を直せた日より後にしない。サーバーは同じ変更にないと確かめないため）
 */
export function injuryInputError(input: InjuryInput, today: string, fixedOn: string | null = null): string | null {
  if (!isSiteCode(input.site)) return '痛めた部位を選んでください';
  if (input.side != null && !SITES[input.site].sided) return `${SITES[input.site].short}には左右がありません`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) return '痛めた日を選んでください';
  if (input.occurredOn > today) return '未来の日には記録できません';
  if (fixedOn && input.occurredOn > fixedOn) return '痛めた日は、直せた日と同じか前の日にしてください';
  for (const f of TEXT_FIELDS) {
    const e = lengthError(f.label, input[f.key], INJURY_LIMITS[f.key]);
    if (e) return e;
  }
  return null;
}

/**
 * ケガの番号（「INJ-03」）。記録した順（作った時刻、同じなら ID の順）に 1 から。2桁にそろえる（100 以上はそのまま）。
 * 消したケガは数えないので、消すと後ろの番号が詰まる
 */
export function injuryNumbers(injuries: { id: string; createdAt: string }[]): Map<string, string> {
  const sorted = [...injuries].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(sorted.map((i, n) => [i.id, `INJ-${String(n + 1).padStart(2, '0')}`]));
}

/** 「11.06」（一覧の日付。数字の字体で出す） */
export function dotDate(key: string): string {
  const [, m, d] = key.split('-');
  return `${m}.${d}`;
}

/** 直せたにする日：今日。痛めた日が今日より後（端末の時計が戻ったなど）なら痛めた日（サーバーは痛めた日より前を断る） */
export function fixedOnFor(occurredOn: string, today: string): string {
  return today < occurredOn ? occurredOn : today;
}
