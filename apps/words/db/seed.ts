// 初期の出会った場所とタグ。ID は固定（ことばの名前空間とキーから uuid5 で決めた値）で、サーバーの words/domain/catalog.py と同じ。
// testdata/words/catalog.json で両方を確かめる（KARADA の初期の部位・種目と同じ考え方）。
// 初期の行は、変えるまで同期で送らない（変えた項目だけを update で送る。db/migrations.ts の backfillOutbox）。並び順は種類ごと

/** ことばの名前空間（表現とタグのつながりの ID を決める） */
export const WORDS_NAMESPACE = '8a3f5c2e-6d1b-4c7a-9e0f-2b4d6a8c1e3f';

export const SEED_SOURCES: { id: string; name: string; icon_key: string; sort_order: number }[] = [
  { id: '24892adf-fd1d-5589-9062-d28dfd19e755', name: 'Audible', icon_key: 'headphones', sort_order: 0 },
  { id: 'a109a3dc-f225-52aa-bf2d-ecb3e3b3640d', name: 'Kindle', icon_key: 'tablet', sort_order: 1 },
  { id: 'c8c59c25-e0b0-5261-aaff-f1f83cdb8c40', name: '紙の本', icon_key: 'book', sort_order: 2 },
  { id: '165b9d87-a526-5a6c-a5fc-b626c218babf', name: '会話', icon_key: 'chat', sort_order: 3 },
  { id: '3a710c88-d0ae-5036-b7fe-7a383f0a6fe3', name: '動画', icon_key: 'film', sort_order: 4 },
];

export const SEED_TAGS: { id: string; kind: 'situation' | 'feeling'; name: string; sort_order: number }[] = [
  { id: '468ef762-a375-555a-9987-acb91ff8de1f', kind: 'situation', name: '励ます', sort_order: 0 },
  { id: 'd8142dbd-39ec-5165-b41d-2dafb4d67270', kind: 'situation', name: '慰める', sort_order: 1 },
  { id: 'a4958143-a9c1-5ed0-9f7d-1a30c53f21fe', kind: 'situation', name: '謝る', sort_order: 2 },
  { id: '2f339b3b-ad8b-5741-b949-fd13dcdce39a', kind: 'situation', name: '断る', sort_order: 3 },
  { id: '7bde32fe-8f6c-528f-a08c-30d60cc20114', kind: 'situation', name: '頼む', sort_order: 4 },
  { id: 'e81a3fb5-aeba-5e23-bad6-46ecdb8c11c2', kind: 'situation', name: 'お礼', sort_order: 5 },
  { id: 'daec3d33-63e8-580b-b569-3559acea3a16', kind: 'situation', name: 'ほめる', sort_order: 6 },
  { id: '6bae2284-6e5c-5c53-aa30-caea25980050', kind: 'situation', name: '反論する', sort_order: 7 },
  { id: '84ca43a1-786c-5ab3-806b-eb45d836c8bb', kind: 'situation', name: 'まとめる', sort_order: 8 },
  { id: 'eda97851-30c9-5d28-bbee-9dc869717295', kind: 'situation', name: '会議で', sort_order: 9 },
  { id: 'c017b117-0d7d-5e2e-86e8-8b3c9590f92f', kind: 'situation', name: '雑談で', sort_order: 10 },
  { id: 'd2ca5cad-5890-5f87-b65d-0e9556a8f321', kind: 'situation', name: '目上に', sort_order: 11 },
  { id: '7475af26-5e5d-5fe6-86cb-6ffaafa1e1aa', kind: 'situation', name: '初対面で', sort_order: 12 },
  { id: '01d74642-768b-5021-8eeb-9a26ce9496a7', kind: 'feeling', name: '安堵', sort_order: 0 },
  { id: '55f2dfb2-80be-5157-90ba-6a1eecb3544d', kind: 'feeling', name: '皮肉', sort_order: 1 },
  { id: '3047c2a7-10e2-5c32-84bb-fae53450eaf4', kind: 'feeling', name: '敬意', sort_order: 2 },
  { id: '06f1a143-7bc7-5c5d-82d0-405b7fbc514f', kind: 'feeling', name: '共感', sort_order: 3 },
  { id: 'adf16fbb-7dd7-5c94-a88c-e3b92e56cc7d', kind: 'feeling', name: 'ためらい', sort_order: 4 },
  { id: '41ed1392-5101-53ea-9270-ed8a254cb686', kind: 'feeling', name: '驚き', sort_order: 5 },
  { id: '9b7d593c-e904-5f9d-8474-dcc9ec6f2e01', kind: 'feeling', name: '感心', sort_order: 6 },
];

/** 出会った場所のアイコンの名前（知らない名前は other として出す） */
export const ICON_KEYS = ['headphones', 'tablet', 'book', 'chat', 'film', 'podcast', 'note', 'other'] as const;
export type IconKey = (typeof ICON_KEYS)[number];
export const iconKeyOf = (v: string): IconKey => ((ICON_KEYS as readonly string[]).includes(v) ? (v as IconKey) : 'other');

/** 初期の場所（AI で拾うの頼みの文に名前を入れてよいのは、この5つだけ） */
export const SEED_SOURCE_IDS = new Set(SEED_SOURCES.map((s) => s.id));

/** 上限（書く側が確かめる。サーバーの words/domain/model.py と同じ） */
export const LIMITS = { sources: 50, tags: 200, expressions: 5000, encountersPerExpression: 50, usagesPerExpression: 500 } as const;
