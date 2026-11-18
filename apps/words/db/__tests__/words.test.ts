import { expressionTagId } from '../repositories/words';
import { SEED_SOURCES, SEED_TAGS } from '../seed';
import { outbox, setup } from '@/test-utils/nodeDb';

const AUDIBLE = SEED_SOURCES[0].id;
const CHEER = SEED_TAGS[0].id; // 励ます

describe('初期の行', () => {
  it('入れても outbox に積まない。タグの並びは種類ごと', async () => {
    const { db, repos } = await setup();
    expect((await repos.catalog.sources()).map((s) => s.name)).toEqual(['Audible', 'Kindle', '紙の本', '会話', '動画']);
    expect((await repos.catalog.tags()).filter((t) => t.kind === 'feeling')[0]).toMatchObject({ name: '安堵', sort_order: 0 });
    expect(await outbox(db)).toEqual([]);
  });
});

describe('拾う', () => {
  it('拾ったに入り、出会いが1つでき、本人が選んだタグは確かめたもの、例文は本人のもの', async () => {
    const { repos } = await setup();
    const r = await repos.words.capture({
      text: ' 肩の荷が下りる ', sourceId: AUDIBLE, title: '街とその不確かな壁', scene: '役目を譲った', tagIds: [CHEER], examples: ['発表が終わって肩の荷が下りた', ' '],
    });
    expect(r).toMatchObject({ outcome: 'created', place: 'collected', handFull: false });
    const e = await repos.words.get(r.id);
    expect(e).toMatchObject({ text: '肩の荷が下りる', normalized_key: '肩の荷が下りる', place: 'collected', stage: null, source_id: AUDIBLE, scene: '役目を譲った' });
    expect(e?.examples).toEqual([{ text: '発表が終わって肩の荷が下りた', origin: 'user', confirmed: true, created_at: '2026-11-18T01:00:00.000Z', updated_at: '2026-11-18T01:00:00.000Z' }]);
    const enc = await repos.words.encounters(r.id);
    expect(enc).toHaveLength(1);
    expect(enc[0]).toMatchObject({ source_id: AUDIBLE, title: '街とその不確かな壁', captured_via: 'app', met_on: '2026-11-18' });
    expect(await repos.words.tagsOf(r.id)).toMatchObject([{ id: expressionTagId(r.id, CHEER), name: '励ます', added_by: 'user', status: 'confirmed' }]);
  });

  it('使いたいなら手札に入れる（間隔1日・明日）', async () => {
    const { repos } = await setup();
    const r = await repos.words.capture({ text: '腑に落ちる', sourceId: null, wantToUse: true });
    expect(await repos.words.get(r.id)).toMatchObject({ place: 'hand', stage: 'understood', interval_days: 1, due_on: '2026-11-19', hand_since: '2026-11-18' });
  });

  it('同じ表現（正規化して同じ）は、また出会ったとして出会いを足し、手札に空きがあれば入れる', async () => {
    const { repos } = await setup();
    const a = await repos.words.capture({ text: '腑に落ちる', sourceId: AUDIBLE });
    const b = await repos.words.capture({ text: '「腑に落ちる」', sourceId: SEED_SOURCES[3].id, title: '佐藤さん' });
    expect(b).toMatchObject({ id: a.id, outcome: 'promoted', place: 'hand' });
    const enc = await repos.words.encounters(a.id);
    expect(enc.map((x) => [x.title, x.wording])).toEqual([['', ''], ['佐藤さん', '「腑に落ちる」']]);
  });

  it('手札は10個まで。いっぱいなら拾ったに入れて知らせる', async () => {
    const { repos } = await setup();
    for (let i = 0; i < 10; i++) await repos.words.capture({ text: `言葉${i}`, sourceId: null, wantToUse: true });
    const r = await repos.words.capture({ text: '十一個目', sourceId: null, wantToUse: true });
    expect(r).toMatchObject({ place: 'collected', handFull: true });
    expect(await repos.words.move(r.id, 'hand')).toEqual({ ok: false, reason: 'hand_full' });
    expect(await repos.words.reencounter(r.id, { text: '十一個目', sourceId: null })).toMatchObject({ outcome: 'reencountered', handFull: true });
  });

  it('入力中の同じ・似た表現', async () => {
    const { repos } = await setup();
    await repos.words.capture({ text: '腑に落ちる', sourceId: null });
    await repos.words.capture({ text: '筋がいい', sourceId: null });
    const m = await repos.words.matches('腑に落ちた');
    expect(m.same).toBeNull();
    expect(m.similar.map((e) => e.text)).toEqual(['腑に落ちる']);
    expect((await repos.words.matches('腑に落ちる。')).same?.text).toBe('腑に落ちる');
  });
});

describe('聞いた・使えた', () => {
  it('聞いたら回数と時刻を残し、手札ならその日の最初の1回だけ間隔を延ばす。聞いた1回も残す', async () => {
    const { repos, deps } = await setup();
    const { id } = await repos.words.capture({ text: '腑に落ちる', sourceId: null, wantToUse: true });
    deps.advance(86_400_000);
    await repos.words.recordListen(id);
    await repos.words.recordListen(id);
    expect(await repos.words.get(id)).toMatchObject({ interval_days: 2, due_on: '2026-11-21', listen_count: 2, listened_at: '2026-11-19T01:00:00.000Z' });
    await repos.words.recordListenSession(new Date('2026-11-19T00:30:00.000Z'), 75, 2);
    expect(await repos.words.listenSessions()).toMatchObject([{ started_at: '2026-11-19T00:30:00.000Z', listened_on: '2026-11-19', seconds: 75, items: 2 }]);
  });

  it('使えたは記録（usage）を足し、段階を使えたに。違う日に2回で使えた日が2つ', async () => {
    const { repos, deps } = await setup();
    const { id } = await repos.words.capture({ text: '筋がいい', sourceId: null, wantToUse: true });
    await repos.words.recordUse(id);
    expect(await repos.words.get(id)).toMatchObject({ stage: 'used', use_count: 1, interval_days: 7, last_used_on: '2026-11-18' });
    deps.advance(2 * 86_400_000);
    await repos.words.recordUse(id);
    expect(await repos.words.useDays(id)).toEqual(['2026-11-18', '2026-11-20']);
    expect(await repos.words.usages()).toHaveLength(2);
  });

  it('夜中（午前4時より前）の使えたは前の日に数える', async () => {
    const { repos, deps } = await setup('2026-11-18T01:00:00.000Z');
    const { id } = await repos.words.capture({ text: '腑に落ちる', sourceId: null, wantToUse: true });
    deps.set('2026-11-19T18:30:00.000Z'); // 日本時間 11/20 3:30
    await repos.words.recordUse(id);
    expect((await repos.words.get(id))?.last_used_on).toBe('2026-11-19');
  });
});

describe('タグ', () => {
  it('Claude の案はワンタップで確かめる。外すとき、Claude の案は rejected、本人のものは消す', async () => {
    const { db, repos } = await setup();
    const { id } = await repos.words.capture({ text: '気に病むことはない', sourceId: null, tagIds: [CHEER] });
    const praise = SEED_TAGS[6].id;
    const now = '2026-11-18T01:00:00.000Z';
    await db.runAsync(`INSERT INTO expression_tags (id, expression_id, tag_id, added_by, status, created_at, updated_at) VALUES (?, ?, ?, 'claude', 'proposed', ?, ?)`,
      [expressionTagId(id, praise), id, praise, now, now]);
    await repos.words.confirmTag(expressionTagId(id, praise));
    expect((await repos.words.tagsOf(id)).map((t) => [t.name, t.status])).toEqual([['励ます', 'confirmed'], ['ほめる', 'confirmed']]);
    await repos.words.removeTag(expressionTagId(id, praise));
    await repos.words.removeTag(expressionTagId(id, CHEER));
    const links = await db.getAllAsync<{ status: string; deleted_at: string | null }>('SELECT status, deleted_at FROM expression_tags ORDER BY added_by', []);
    expect(links).toEqual([{ status: 'rejected', deleted_at: null }, { status: 'confirmed', deleted_at: now }]);
  });
});

describe('例文', () => {
  it('Claude の案はワンタップで確かめ、外すと一覧から消える。本人も足せる。探す文字に入る', async () => {
    const { db, repos } = await setup();
    const { id } = await repos.words.capture({ text: '腑に落ちる', sourceId: null, examples: ['自分の一文'] });
    const claude = (text: string) => ({ text, origin: 'claude', confirmed: false, created_at: 't', updated_at: 't' });
    const e0 = await repos.words.get(id);
    await db.runAsync('UPDATE expressions SET examples = ? WHERE id = ?',
      [JSON.stringify([...e0!.examples, claude('先輩のひと言で、ようやく腑に落ちた。'), claude('どうも腑に落ちない。')]), id]);
    await repos.words.confirmExample(id, '先輩のひと言で、ようやく腑に落ちた。');
    await repos.words.removeExample(id, 'どうも腑に落ちない。');
    await repos.words.addExample(id, '会議のあとで腑に落ちた');
    const e = await repos.words.get(id);
    expect(e?.examples.map((x) => [x.text, x.origin, x.confirmed])).toEqual([
      ['自分の一文', 'user', true], ['先輩のひと言で、ようやく腑に落ちた。', 'claude', true], ['会議のあとで腑に落ちた', 'user', true],
    ]);
    expect(await repos.words.searchIds(['%会議のあとで%'])).toEqual([id]);
    expect(await repos.words.searchIds(['%先輩のひと言で%'])).toEqual([id]);
    expect(await repos.words.searchIds(['%どうも腑に落ちない%'])).toEqual([]);
  });
});

describe('探す文字', () => {
  it('表現・出会い・タグを書いたら作り直し、LIKE の「かつ」で探す', async () => {
    const { repos } = await setup();
    const a = await repos.words.capture({ text: '腑に落ちる', sourceId: null, title: '舟を編む', tagIds: [CHEER] });
    await repos.words.capture({ text: '筋がいい', sourceId: null, scene: '企画をほめられて' });
    await repos.words.updateUserFields(a.id, { reading: 'フニオチル' });
    const find = (q: string[]) => repos.words.searchIds(q.map((t) => `%${t}%`));
    expect(await find(['ふにおち'])).toEqual([a.id]);
    expect(await find(['舟を編む', '励ます'])).toEqual([a.id]);
    expect(await find(['ほめられて'])).toHaveLength(1);
    expect(await find(['舟', '企画'])).toEqual([]);
    await repos.catalog.updateTag(CHEER, { name: '元気づける' });
    expect(await find(['元気づける'])).toEqual([a.id]);
  });
});
