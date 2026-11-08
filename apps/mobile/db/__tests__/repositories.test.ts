import { LATEST_VERSION, migrate, MIGRATIONS } from '../migrations';
import { HiddenDuplicateError } from '../repositories/catalog';
import { SEED_BODY_PARTS, SEED_EXERCISES } from '../seed';
import { memoryDb, repos, testDeps } from '@/test-utils/nodeDb';

async function setup() {
  const db = memoryDb();
  const deps = testDeps();
  await migrate(db, deps.now);
  return { db, deps, r: repos(db, deps) };
}

const BENCH = SEED_EXERCISES[0].id;
const SQUAT = SEED_EXERCISES.find((e) => e.name === 'スクワット')!.id;
const DEADLIFT = SEED_EXERCISES.find((e) => e.name === 'デッドリフト')!.id;
const CHEST = SEED_BODY_PARTS[0].id;

describe('マイグレーション', () => {
  test('版を記録し、2回目は何もしない', async () => {
    const db = memoryDb();
    expect(await migrate(db)).toBe(LATEST_VERSION);
    expect(db.raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: LATEST_VERSION });
    expect(await migrate(db)).toBe(LATEST_VERSION);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM body_parts').get()).toEqual({ n: SEED_BODY_PARTS.length });
  });

  test('途中で失敗したら、その版は当たらない', async () => {
    const db = memoryDb();
    await migrate(db);
    MIGRATIONS.push({ version: LATEST_VERSION + 1, up: async (d) => { await d.execAsync('CREATE TABLE x (a); SELECT * FROM nope;'); } });
    try {
      await expect(migrate(db)).rejects.toThrow();
      expect(db.raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: LATEST_VERSION });
      expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'x'").get()).toBeUndefined();
    } finally {
      MIGRATIONS.pop();
    }
  });

  test('どの表も同期用の列を持つ', async () => {
    const { db } = await setup();
    for (const t of ['body_parts', 'exercises', 'workout_entries', 'workout_sets', 'body_records', 'settings']) {
      const cols = db.raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => (c as { name: string }).name);
      expect(cols).toEqual(expect.arrayContaining(['id', 'created_at', 'updated_at', 'deleted_at']));
    }
  });
});

describe('設定', () => {
  test('初期値と更新', async () => {
    const { r } = await setup();
    expect(await r.settings.get()).toEqual({ weightUnit: 'kg', defaultSetCount: 3, heightCm: null, goalWeightKg: null });
    await r.settings.update({ weightUnit: 'lb', defaultSetCount: 5, heightCm: 170 });
    await r.settings.update({ heightCm: null, goalWeightKg: 65 });
    expect(await r.settings.get()).toEqual({ weightUnit: 'lb', defaultSetCount: 5, heightCm: null, goalWeightKg: 65 });
    await expect(r.settings.update({ defaultSetCount: 7 })).rejects.toThrow();
  });

  test('今の値と同じなら書かない（初期値と同じ値も、空を空にするのも）', async () => {
    const { r, db, deps } = await setup();
    const rows = () => db.raw.prepare('SELECT id, value, updated_at FROM settings ORDER BY id').all();
    await r.settings.update({ weightUnit: 'kg', defaultSetCount: 3, heightCm: null, goalWeightKg: null });
    expect(rows()).toEqual([]);
    await r.settings.update({ heightCm: 170 });
    const saved = rows();
    deps.advance(1000);
    await r.settings.update({ heightCm: 170, weightUnit: 'kg' });
    expect(rows()).toEqual(saved);
    // 変わった項目だけ書く
    await r.settings.update({ heightCm: 170, goalWeightKg: 65 });
    expect(rows()).toEqual([
      { id: 'goal_weight_kg', value: '65', updated_at: '2026-11-08T00:00:01.000Z' },
      ...saved,
    ]);
  });

  test('保存が重なっても、両方とも保存する', async () => {
    // 身長の欄を離れたときの保存と、単位の切り替えなどが同時に走る。トランザクションが入れ子になって失敗していた
    const { r } = await setup();
    await Promise.all([r.settings.update({ heightCm: 170 }), r.settings.update({ goalWeightKg: 65 }), r.settings.update({ weightUnit: 'lb' })]);
    expect(await r.settings.get()).toEqual({ weightUnit: 'lb', defaultSetCount: 3, heightCm: 170, goalWeightKg: 65 });
  });
});

describe('種目と部位', () => {
  test('初期のデータと、種目の追加', async () => {
    const { r } = await setup();
    const parts = await r.catalog.listBodyParts();
    expect(parts.map((p) => p.name)).toEqual(['胸', '背中', '肩', '脚', '上腕二頭筋', '上腕三頭筋', '腹筋']);
    const id = await r.catalog.createExercise({ name: ' インクラインベンチプレス ', bodyPartId: CHEST, recordType: 'weight_reps' });
    const ex = await r.catalog.getExercise(id);
    expect(ex).toMatchObject({ name: 'インクラインベンチプレス', bodyPartName: '胸', hidden: false });
    await expect(r.catalog.createExercise({ name: 'インクラインベンチプレス', bodyPartId: CHEST, recordType: 'weight_reps' })).rejects.toThrow('同じ部位');
    await expect(r.catalog.createExercise({ name: '  ', bodyPartId: CHEST, recordType: 'weight_reps' })).rejects.toThrow();
  });

  test('同じ種目・部位の追加が重なっても、1つだけ足す', async () => {
    // 「追加する」を素早く2回押したとき
    const { r } = await setup();
    const results = await Promise.allSettled([
      r.catalog.createExercise({ name: 'ケーブルクロス', bodyPartId: CHEST, recordType: 'weight_reps' }),
      r.catalog.createExercise({ name: 'ケーブルクロス', bodyPartId: CHEST, recordType: 'weight_reps' }),
      r.catalog.createBodyPart('前腕'),
      r.catalog.createBodyPart('前腕'),
    ]);
    expect(results.map((x) => x.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'rejected']);
    expect((await r.catalog.listExercises()).filter((e) => e.name === 'ケーブルクロス')).toHaveLength(1);
    expect((await r.catalog.listBodyParts()).filter((p) => p.name === '前腕')).toHaveLength(1);
  });

  test('非表示にしても消さない。部位を隠すと、その種目も一覧から外れる', async () => {
    const { r } = await setup();
    await r.catalog.setExerciseHidden(BENCH, true);
    expect((await r.catalog.listExercises()).some((e) => e.id === BENCH)).toBe(false);
    expect((await r.catalog.listExercises({ includeHidden: true })).find((e) => e.id === BENCH)?.hidden).toBe(true);
    expect(await r.catalog.getExercise(BENCH)).not.toBeNull();
    await r.catalog.setBodyPartHidden(CHEST, true);
    expect((await r.catalog.listExercises()).some((e) => e.bodyPartId === CHEST)).toBe(false);
    expect((await r.catalog.listBodyParts()).some((p) => p.id === CHEST)).toBe(false);
    const newPart = await r.catalog.createBodyPart('前腕');
    expect((await r.catalog.listBodyParts()).at(-1)?.id).toBe(newPart);
  });

  test('種目と部位の名前は、前後の空白を取って40文字まで', async () => {
    const { r } = await setup();
    const n40 = 'ア'.repeat(39) + '💪'; // 絵文字も1文字と数える
    const id = await r.catalog.createExercise({ name: `  ${n40}  `, bodyPartId: CHEST, recordType: 'weight_reps' });
    expect((await r.catalog.getExercise(id))?.name).toBe(n40);
    await expect(r.catalog.createExercise({ name: 'イ'.repeat(41), bodyPartId: CHEST, recordType: 'weight_reps' }))
      .rejects.toThrow('種目の名前は40文字以内で入れてください（今は41文字）');
    const part = await r.catalog.createBodyPart(` ${'ウ'.repeat(40)} `);
    expect((await r.catalog.listBodyParts()).find((p) => p.id === part)?.name).toBe('ウ'.repeat(40));
    await expect(r.catalog.createBodyPart('エ'.repeat(41))).rejects.toThrow('部位の名前は40文字以内で入れてください（今は41文字）');
  });

  test('非表示の部位・種目と同じ名前を足そうとすると、その ID を添えて知らせる（足さない）', async () => {
    const { r } = await setup();
    const ABS = SEED_BODY_PARTS.find((p) => p.name === '腹筋')!.id;
    await r.catalog.setBodyPartHidden(ABS, true);
    const part = await r.catalog.createBodyPart(' 腹筋 ').catch((e) => e);
    expect(part).toBeInstanceOf(HiddenDuplicateError);
    expect(part).toMatchObject({ id: ABS, message: '非表示の部位があります。表示に戻しますか？' });

    await r.catalog.setExerciseHidden(BENCH, true);
    const ex = await r.catalog.createExercise({ name: 'ベンチプレス', bodyPartId: CHEST, recordType: 'weight_reps' }).catch((e) => e);
    expect(ex).toBeInstanceOf(HiddenDuplicateError);
    expect(ex).toMatchObject({ id: BENCH, message: '非表示の種目があります。表示に戻しますか？' });

    // 表示しているものと同じ名前なら、今までどおり
    await expect(r.catalog.createBodyPart('胸')).rejects.not.toBeInstanceOf(HiddenDuplicateError);
    await expect(r.catalog.createBodyPart('胸')).rejects.toThrow('同じ名前の部位があります');
    expect((await r.catalog.listBodyParts({ includeHidden: true })).filter((p) => p.name === '腹筋')).toHaveLength(1);
    expect((await r.catalog.listExercises({ includeHidden: true })).filter((e) => e.name === 'ベンチプレス')).toHaveLength(1);
  });
});

describe('筋トレの記録', () => {
  const set = (weightKg: number | null, reps: number, extra: { id?: string; memo?: string } = {}) =>
    ({ weightKg, reps, memo: '', done: true, ...extra });

  test('保存・読み出し・前回', async () => {
    const { r } = await setup();
    await r.workouts.saveEntry({ date: '2026-11-06', exerciseId: BENCH, sets: [set(80, 8), set(75, 10)] });
    const id = await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: [set(80, 8, { memo: '良し' })] });
    await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: SQUAT, sets: [set(100, 5)] });

    const day = await r.workouts.getDay('2026-11-08');
    expect(day.map((e) => e.exerciseName)).toEqual(['ベンチプレス', 'スクワット']);
    expect(day[0].sets[0]).toMatchObject({ weightKg: 80, reps: 8, memo: '良し', done: true, setIndex: 0 });

    const prev = await r.workouts.previousEntry(BENCH, '2026-11-08');
    expect(prev?.date).toBe('2026-11-06');
    expect(prev?.sets.map((s) => s.weightKg)).toEqual([80, 75]);
    expect(await r.workouts.findEntry('2026-11-08', BENCH)).toMatchObject({ id });
  });

  test('直すと、セットは ID で更新し、外したものは論理削除する', async () => {
    const { r, db } = await setup();
    const id = await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: [set(80, 8), set(80, 7), set(80, 6)] });
    const before = (await r.workouts.getEntry(id))!.sets;
    await r.workouts.saveEntry({
      id, date: '2026-11-08', exerciseId: BENCH,
      sets: [set(82.5, 8, { id: before[0].id }), set(80, 6, { id: before[2].id }), set(70, 10)],
    });
    const after = (await r.workouts.getEntry(id))!.sets;
    expect(after.map((s) => [s.weightKg, s.reps])).toEqual([[82.5, 8], [80, 6], [70, 10]]);
    expect(after[0].id).toBe(before[0].id);
    expect(after[1].id).toBe(before[2].id);
    const deleted = db.raw.prepare('SELECT id FROM workout_sets WHERE deleted_at IS NOT NULL').all();
    expect(deleted).toEqual([{ id: before[1].id }]);
    await expect(r.workouts.saveEntry({ id, date: '2026-11-08', exerciseId: BENCH, sets: [] })).rejects.toThrow();
  });

  test('並べ替えや保存が重なっても、失敗せず順に当たる', async () => {
    // ↑ を素早く2回押したときなど
    const { r } = await setup();
    const a = await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: [set(80, 8)] });
    const b = await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: SQUAT, sets: [set(100, 5)] });
    const c = await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: DEADLIFT, sets: [set(120, 3)] });
    await Promise.all([r.workouts.moveEntry(c, -1), r.workouts.moveEntry(c, -1)]);
    expect((await r.workouts.getDay('2026-11-08')).map((e) => e.id)).toEqual([c, a, b]);
    await Promise.all([
      r.workouts.saveEntry({ id: a, date: '2026-11-08', exerciseId: BENCH, sets: [set(85, 5)] }),
      r.workouts.deleteEntry(b),
    ]);
    expect((await r.workouts.getDay('2026-11-08')).map((e) => [e.id, e.sets.map((x) => x.weightKg)])).toEqual([[c, [120]], [a, [85]]]);
  });

  test('並べ替えと、種目を外す', async () => {
    const { r } = await setup();
    const a = await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: [set(80, 8)] });
    const b = await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: SQUAT, sets: [set(100, 5)] });
    await r.workouts.moveEntry(b, -1);
    expect((await r.workouts.getDay('2026-11-08')).map((e) => e.id)).toEqual([b, a]);
    await r.workouts.moveEntry(b, -1); // 先頭より上には行かない
    expect((await r.workouts.getDay('2026-11-08')).map((e) => e.id)).toEqual([b, a]);
    await r.workouts.deleteEntry(b);
    expect((await r.workouts.getDay('2026-11-08')).map((e) => e.id)).toEqual([a]);
    expect(await r.workouts.allSetRows()).toEqual([
      { date: '2026-11-08', exerciseId: BENCH, bodyPartId: CHEST, weightKg: 80, reps: 8 },
    ]);
    // 外したあとに足した種目は、最後に並ぶ
    const c = await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: SQUAT, sets: [set(100, 5)] });
    expect((await r.workouts.getDay('2026-11-08')).map((e) => e.id)).toEqual([a, c]);
  });

  test('非表示の種目の記録も、集計と CSV に残る', async () => {
    const { r } = await setup();
    await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: [set(80, 8, { memo: 'a,b' })] });
    await r.catalog.setExerciseHidden(BENCH, true);
    expect(await r.workouts.allSetRows()).toHaveLength(1);
    expect(await r.workouts.exportRows()).toEqual([
      { date: '2026-11-08', body_part: '胸', exercise: 'ベンチプレス', set_index: 0, weight_kg: 80, reps: 8, memo: 'a,b', done: 1 },
    ]);
  });
});

describe('並び順が同じとき（同期でほかの端末の記録が入ったときなど）は、ID の順に並べる（サーバーと同じ）', () => {
  // 種目は (date, sort_order, id)、セットは (set_index, id)。ID の順と逆に足して、足した順に頼っていないことを確かめる
  async function sameOrder() {
    const { db, r } = await setup();
    const now = '2026-11-08T00:00:00.000Z';
    const entry = (id: string, exerciseId: string) => db.raw.prepare(
      'INSERT INTO workout_entries (id, date, exercise_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    ).run(id, '2026-11-08', exerciseId, now, now);
    const set = (id: string, entryId: string, reps: number) => db.raw.prepare(
      'INSERT INTO workout_sets (id, entry_id, set_index, weight_kg, reps, memo, done, created_at, updated_at) VALUES (?, ?, 0, 50, ?, \'\', 1, ?, ?)',
    ).run(id, entryId, reps, now, now);
    entry('e-b', SQUAT);
    entry('e-a', BENCH);
    set('s-b', 'e-a', 2);
    set('s-a', 'e-a', 1);
    set('s-c', 'e-b', 3);
    return r;
  }

  test('その日の記録と、種目のセット', async () => {
    const r = await sameOrder();
    const day = await r.workouts.getDay('2026-11-08');
    expect(day.map((e) => e.id)).toEqual(['e-a', 'e-b']);
    expect(day[0].sets.map((s) => s.id)).toEqual(['s-a', 's-b']);
  });

  test('集計と CSV', async () => {
    const r = await sameOrder();
    expect((await r.workouts.allSetRows()).map((s) => s.reps)).toEqual([1, 2, 3]);
    expect((await r.workouts.exportRows()).map((s) => s.reps)).toEqual([1, 2, 3]);
  });
});

describe('体組成', () => {
  test('手入力は1日1件を書き換え、null で項目を消せる', async () => {
    const { r, db, deps } = await setup();
    await r.body.saveManual('2026-11-08', { weightKg: 68.4, memo: '朝' });
    deps.advance(1000);
    await r.body.saveManual('2026-11-08', { bodyFatPct: 16.2 });
    await r.body.saveManual('2026-11-08', { weightKg: null });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM body_records').get()).toEqual({ n: 1 });
    expect(await r.body.getDay('2026-11-08')).toEqual({
      date: '2026-11-08', weightKg: null, bodyFatPct: 16.2, musclePct: null, waistCm: null, memo: '朝',
    });
    const row = db.raw.prepare('SELECT source, external_id, origin_package FROM body_records').get();
    expect(row).toEqual({ source: 'manual', external_id: null, origin_package: null });
  });

  test('記録のない日に値を消しても、空の行を作らない。値が変わらなければ書かない', async () => {
    const { r, db, deps } = await setup();
    const rows = () => db.raw.prepare('SELECT date, weight_kg, memo, updated_at FROM body_records').all();
    await r.body.saveManual('2026-11-08', { weightKg: null });
    await r.body.saveManual('2026-11-08', { memo: '' });
    await r.body.saveManual('2026-11-08', { bodyFatPct: null, musclePct: null, waistCm: null, memo: '' });
    expect(rows()).toEqual([]);
    await r.body.saveManual('2026-11-08', { weightKg: 68.4, memo: '朝' });
    const saved = rows();
    deps.advance(1000);
    await r.body.saveManual('2026-11-08', { weightKg: 68.4 });
    await r.body.saveManual('2026-11-08', { memo: '朝', bodyFatPct: null });
    expect(rows()).toEqual(saved);
    await r.body.saveManual('2026-11-08', { weightKg: 68.4, waistCm: 80 });
    expect(rows()).toEqual([{ date: '2026-11-08', weight_kg: 68.4, memo: '朝', updated_at: '2026-11-08T00:00:01.000Z' }]);
  });

  test('同じ日の手入力の保存が重なっても、手入力の行は1件だけで、あとから消せる', async () => {
    // 体組成の画面は欄を離れたときに保存する。別の欄の「×」などと重なると、2つの保存が同時に走る
    const { r, db } = await setup();
    await Promise.all([
      r.body.saveManual('2026-11-08', { weightKg: 70 }),
      r.body.saveManual('2026-11-08', { bodyFatPct: 20 }),
    ]);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM body_records WHERE source = 'manual'").get()).toEqual({ n: 1 });
    await r.body.saveManual('2026-11-08', { weightKg: null });
    expect(await r.body.getDay('2026-11-08')).toMatchObject({ weightKg: null, bodyFatPct: 20 });
  });

  test('1日に複数の記録があるときは、項目ごとに新しいものを使う', async () => {
    const { r, db } = await setup();
    const ins = db.raw.prepare(`INSERT INTO body_records (id, date, measured_at, weight_kg, body_fat_pct, source, external_id, origin_package, created_at, updated_at)
      VALUES (?, '2026-11-08', ?, ?, ?, 'health_connect', ?, 'com.example.scale', 'x', 'x')`);
    ins.run('hc1', '2026-11-08T07:00:00.000Z', 68.9, 16.5, 'ext-1');
    ins.run('hc2', '2026-11-08T21:00:00.000Z', 68.2, null, 'ext-2');
    expect(await r.body.getDay('2026-11-08')).toMatchObject({ weightKg: 68.2, bodyFatPct: 16.5 });
  });

  test('同じ取り込み元と ID の組は1行だけ（消した行も含む）', async () => {
    const { db } = await setup();
    const ins = db.raw.prepare(`INSERT INTO body_records (id, date, measured_at, weight_kg, source, external_id, created_at, updated_at, deleted_at)
      VALUES (?, '2026-11-08', 'x', 68, 'health_connect', 'ext-1', 'x', 'x', ?)`);
    ins.run('a', 'x');
    expect(() => ins.run('b', null)).toThrow(/UNIQUE/);
    // 手入力（external_id が NULL）は何件でも入る
    const manual = db.raw.prepare(`INSERT INTO body_records (id, date, measured_at, source, created_at, updated_at) VALUES (?, '2026-11-08', 'x', 'manual', 'x', 'x')`);
    manual.run('m1');
    manual.run('m2');
  });

  test('日ごとの一覧は古い順', async () => {
    const { r } = await setup();
    await r.body.saveManual('2026-11-08', { weightKg: 68.4 });
    await r.body.saveManual('2026-11-01', { weightKg: 69.0 });
    expect((await r.body.listDaily()).map((d) => [d.date, d.weightKg])).toEqual([['2026-11-01', 69], ['2026-11-08', 68.4]]);
  });
});
