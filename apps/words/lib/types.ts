/**
 * ことばの記録の形（docs/words-design.md の「データ」、サーバーの services/words/words/domain/model.py と
 * infrastructure/sync_entities.py）。端末の表の列と同じ名前（同期の項目の名前）にする
 */
import type { DateKey } from './date';

export type Place = 'collected' | 'hand' | 'own';
/** 手札の中の段階（意味がわかる → 使えた）。手札でないときは null */
export type Stage = 'understood' | 'used';
export type Register = 'spoken' | 'written' | 'formal';
export type TagKind = 'situation' | 'feeling';
export type TagStatus = 'confirmed' | 'proposed' | 'rejected';
export type Author = 'user' | 'claude';

export const PLACE_LABELS: Record<Place, string> = { collected: '拾った', hand: '手札', own: '自分の言葉' };
export const STAGE_LABELS: Record<Stage, string> = { understood: '意味がわかる', used: '使えた' };
export const STAGE_STEPS: Record<Stage, number> = { understood: 1, used: 2 };
export const REGISTER_LABELS: Record<Register, string> = { spoken: '話し言葉', written: '書き言葉', formal: '改まった' };
export const REGISTERS: Register[] = ['spoken', 'written', 'formal'];
export const TAG_KIND_LABELS: Record<TagKind, string> = { situation: '使う場面', feeling: '気持ち' };

/** 手札の上限 */
export const HAND_LIMIT = 10;
/** 例文の上限（本人のものと Claude のものを合わせて） */
export const MAX_EXAMPLES = 8;
export const MAX_EXAMPLE = 200;

/** 間隔の項目（聞いた・使えたで一緒に変わる。同期では組で送る） */
export type Schedule = {
  stage: Stage | null;
  interval_days: number;
  due_on: DateKey | null;
  /** 最後に聞いた時刻（RFC 3339） */
  listened_at: string | null;
  listen_count: number;
  use_count: number;
  last_used_on: DateKey | null;
};

/** 例文1つ。本人のもの（origin user。いつも confirmed）と、Claude のもの（補う。本人が確かめたら confirmed） */
export type Example = {
  text: string;
  origin: Author;
  confirmed: boolean;
  created_at: string;
  updated_at: string;
};

export type Expression = Schedule & {
  id: string;
  text: string;
  source_id: string | null;
  normalized_key: string;
  scene: string;
  note: string;
  star: boolean;
  place: Place;
  moved_at: string;
  hand_since: DateKey | null;
  reading: string;
  use_note: string;
  meaning: string;
  nuance: string;
  register: Register | null;
  register_by: Author | null;
  examples: Example[];
  similar: string[];
  usefulness: number | null;
  usefulness_reason: string;
  usefulness_until: DateKey | null;
  enriched_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Source = {
  id: string;
  name: string;
  icon_key: string;
  sort_order: number;
  hidden: boolean;
};

export type Tag = {
  id: string;
  kind: TagKind;
  name: string;
  sort_order: number;
  hidden: boolean;
  created_by: 'user' | 'claude' | 'seed';
};

export type ExpressionTag = {
  id: string;
  expression_id: string;
  tag_id: string;
  added_by: Author;
  status: TagStatus;
  confirmed_at: string | null;
};

export type Encounter = {
  id: string;
  expression_id: string;
  source_id: string | null;
  title: string;
  locator: string;
  met_on: DateKey | null;
  time_hint: string;
  scene: string;
  surrounding_text: string;
  wording: string;
  captured_via: 'mcp' | 'app';
  note: string;
  created_at: string;
};

/** 使えたの記録（追記だけ） */
export type Usage = { id: string; expression_id: string; used_on: DateKey; scene: string; note: string };

/** 聞いた1回（追記だけ。活動の記録に使う） */
export type ListenSession = { id: string; started_at: string; listened_on: DateKey; seconds: number; items: number };
