import { LATEST_VERSION, migrate, MIGRATIONS } from '../migrations';
import { HiddenDuplicateError } from '../repositories/catalog';
import { SEED_BODY_PARTS, SEED_EXERCISES } from '../seed';
import { big3Assignments } from '@/lib/exercises';
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
    expect(await r.settings.get()).toEqual({ weightUnit: 'kg', defaultSetCount: 3, heightCm: null, goalWeightKg: null, activity: null, weeklyGoalTrainingDays: 3, weeklyGoalMealDays: 5, weeklyGoalSleepDays: 4, restTimerSeconds: 90 });
    await r.settings.update({ weightUnit: 'lb', defaultSetCount: 5, heightCm: 170 });
    await r.settings.update({ heightCm: null, goalWeightKg: 65, activity: 'light' });
    expect(await r.settings.get()).toEqual({ weightUnit: 'lb', defaultSetCount: 5, heightCm: null, goalWeightKg: 65, activity: 'light', weeklyGoalTrainingDays: 3, weeklyGoalMealDays: 5, weeklyGoalSleepDays: 4, restTimerSeconds: 90 });
    await expect(r.settings.update({ defaultSetCount: 7 })).rejects.toThrow();
  });

  test('今週の目標と休憩のタイマー：選択肢の値だけ保存し、ほかの設定と同じく同期に積む', async () => {
    const { r, db } = await setup();
    await r.settings.update({ weeklyGoalTrainingDays: 5, weeklyGoalMealDays: 7, weeklyGoalSleepDays: 0, restTimerSeconds: 0 });
    expect(await r.settings.get()).toMatchObject({ weeklyGoalTrainingDays: 5, weeklyGoalMealDays: 7, weeklyGoalSleepDays: 0, restTimerSeconds: 0 });
    // 同期の ID は、ほかの設定と同じ snake_case（サーバーの period_overview が読む）
    expect(db.raw.prepare("SELECT entity_id, fields FROM sync_outbox WHERE entity_type = 'setting' ORDER BY entity_id").all()).toEqual([
      { entity_id: 'rest_timer_seconds', fields: JSON.stringify({ value: '0' }) },
      { entity_id: 'weekly_goal_meal_days', fields: JSON.stringify({ value: '7' }) },
      { entity_id: 'weekly_goal_sleep_days', fields: JSON.stringify({ value: '0' }) },
      { entity_id: 'weekly_goal_training_days', fields: JSON.stringify({ value: '5' }) },
    ]);
    for (const bad of [{ weeklyGoalTrainingDays: 1 }, { weeklyGoalMealDays: 4 }, { weeklyGoalSleepDays: 6 }, { restTimerSeconds: 30 }]) {
      await expect(r.settings.update(bad)).rejects.toThrow();
    }
    // 選択肢にない値（壊れた値、ほかの版が書いた値）は初期値として読む
    db.raw.prepare("UPDATE settings SET value = '9' WHERE id IN ('weekly_goal_training_days', 'rest_timer_seconds')").run();
    db.raw.prepare("UPDATE settings SET value = 'x' WHERE id = 'weekly_goal_meal_days'").run();
    expect(await r.settings.get()).toMatchObject({ weeklyGoalTrainingDays: 3, weeklyGoalMealDays: 5, weeklyGoalSleepDays: 0, restTimerSeconds: 90 });
  });

  test('今の値と同じなら書かない（初期値と同じ値も、空を空にするのも）', async () => {
    const { r, db, deps } = await setup();
    const rows = () => db.raw.prepare('SELECT id, value, updated_at FROM settings ORDER BY id').all();
    await r.settings.update({ weightUnit: 'kg', defaultSetCount: 3, heightCm: null, goalWeightKg: null, activity: null, weeklyGoalTrainingDays: 3, weeklyGoalMealDays: 5, weeklyGoalSleepDays: 4, restTimerSeconds: 90 });
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
    expect(await r.settings.get()).toEqual({ weightUnit: 'lb', defaultSetCount: 3, heightCm: 170, goalWeightKg: 65, activity: null, weeklyGoalTrainingDays: 3, weeklyGoalMealDays: 5, weeklyGoalSleepDays: 4, restTimerSeconds: 90 });
  });

  test('最後に選んだチャットのアプリは端末だけに覚え、同期に載せない', async () => {
    const { r, db } = await setup();
    expect(await r.settings.lastChatApp()).toBeNull();
    await r.settings.setLastChatApp('claude');
    expect(await r.settings.lastChatApp()).toBe('claude');
    await r.settings.setLastChatApp('chatgpt');
    expect(await r.settings.lastChatApp()).toBe('chatgpt');
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type = 'setting'").get()).toEqual({ n: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
    // 知らない値は覚えていないことにする
    db.raw.prepare("UPDATE sync_meta SET value = 'other' WHERE key = 'chat.last_app'").run();
    expect(await r.settings.lastChatApp()).toBeNull();
  });

  test('履歴の総負荷量のグラフの「週・日」は端末だけに覚え、同期に載せない。初めは週', async () => {
    const { r, db } = await setup();
    expect(await r.settings.volumeRange()).toBe('week');
    await r.settings.setVolumeRange('day');
    expect(await r.settings.volumeRange()).toBe('day');
    await r.settings.setVolumeRange('week');
    expect(await r.settings.volumeRange()).toBe('week');
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type = 'setting'").get()).toEqual({ n: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
    // 知らない値は週
    db.raw.prepare("UPDATE sync_meta SET value = 'month' WHERE key = 'history.volume_range'").run();
    expect(await r.settings.volumeRange()).toBe('week');
  });

  test('活動の量は設定（同期する）。性別・生まれた年・自動計算の体重は端末だけに覚え、同期に載せない', async () => {
    const { r, db } = await setup();
    await r.settings.update({ activity: 'moderate' });
    expect(db.raw.prepare("SELECT entity_id FROM sync_outbox WHERE entity_type = 'setting'").all()).toEqual([{ entity_id: 'activity_level' }]);
    expect(await r.settings.profile()).toEqual({ sex: null, birthYear: null });
    await r.settings.setProfile({ sex: 'female', birthYear: 1990 });
    await r.settings.setAutoGoalWeight(68.3);
    expect(await r.settings.profile()).toEqual({ sex: 'female', birthYear: 1990 });
    expect(await r.settings.autoGoalWeight()).toBe(68.3);
    await r.settings.setProfile({ birthYear: null });
    expect(await r.settings.profile()).toEqual({ sex: 'female', birthYear: null });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type = 'setting'").get()).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 1 });
    // 知らない値は入れていないことにする
    db.raw.prepare("UPDATE sync_meta SET value = 'x' WHERE key = 'profile.sex'").run();
    db.raw.prepare("UPDATE settings SET value = 'x' WHERE id = 'activity_level'").run();
    expect((await r.settings.profile()).sex).toBeNull();
    expect((await r.settings.get()).activity).toBeNull();
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

  test('種目の名前と部位を変える。同じ部位に同じ名前は断る。部位を変えたらその部位の最後', async () => {
    const { r } = await setup();
    const SHOULDER = SEED_BODY_PARTS.find((p) => p.name === '肩')!.id;
    await r.workouts.saveEntry({ date: '2026-11-01', exerciseId: BENCH, sets: [{ weightKg: 80, reps: 8, memo: '', done: true }] });
    await r.catalog.updateExercise(BENCH, { name: ' バーベルベンチプレス ', bodyPartId: CHEST });
    expect(await r.catalog.getExercise(BENCH)).toMatchObject({ name: 'バーベルベンチプレス', bodyPartName: '胸', sortOrder: 0 });
    // 過去の記録も新しい名前で出る（記録は ID でつながる）
    expect((await r.workouts.getDay('2026-11-01'))[0].exerciseName).toBe('バーベルベンチプレス');

    await expect(r.catalog.updateExercise(BENCH, { name: 'ダンベルフライ', bodyPartId: CHEST })).rejects.toThrow('同じ部位に同じ名前の種目があります');
    await r.catalog.setExerciseHidden(SEED_EXERCISES.find((e) => e.name === 'ケーブルフライ')!.id, true);
    await expect(r.catalog.updateExercise(BENCH, { name: 'ケーブルフライ', bodyPartId: CHEST })).rejects.toThrow('非表示の種目があります');
    await expect(r.catalog.updateExercise(BENCH, { name: ' ', bodyPartId: CHEST })).rejects.toThrow('種目の名前を入れてください');
    await expect(r.catalog.updateExercise(BENCH, { name: 'イ'.repeat(41), bodyPartId: CHEST })).rejects.toThrow('40文字以内');

    // ほかの部位なら同じ名前でもよい。並びはその部位の最後
    await r.catalog.updateExercise(BENCH, { name: 'ダンベルフライ', bodyPartId: SHOULDER });
    const shoulders = (await r.catalog.listExercises()).filter((e) => e.bodyPartId === SHOULDER);
    expect(shoulders.at(-1)).toMatchObject({ id: BENCH, name: 'ダンベルフライ', bodyPartName: '肩' });
    expect((await r.workouts.getDay('2026-11-01'))[0]).toMatchObject({ exerciseName: 'ダンベルフライ', bodyPartName: '肩' });
  });

  test('部位の名前を変える。同じ名前の部位は断る', async () => {
    const { r } = await setup();
    await r.catalog.renameBodyPart(CHEST, ' 大胸筋 ');
    expect((await r.catalog.listBodyParts())[0]).toMatchObject({ id: CHEST, name: '大胸筋' });
    expect((await r.catalog.getExercise(BENCH))?.bodyPartName).toBe('大胸筋');
    await r.catalog.renameBodyPart(CHEST, '大胸筋'); // 同じ名前のままはよい
    await expect(r.catalog.renameBodyPart(CHEST, '背中')).rejects.toThrow('同じ名前の部位があります');
    const ABS = SEED_BODY_PARTS.find((p) => p.name === '腹筋')!.id;
    await r.catalog.setBodyPartHidden(ABS, true);
    await expect(r.catalog.renameBodyPart(CHEST, '腹筋')).rejects.toThrow('同じ名前の非表示の部位があります');
    await expect(r.catalog.renameBodyPart(CHEST, '')).rejects.toThrow('部位の名前を入れてください');
    await expect(r.catalog.renameBodyPart(CHEST, 'エ'.repeat(41))).rejects.toThrow('部位の名前は40文字以内');
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

describe('BIG3 の役とフォームの動画', () => {
  const roles = async (r: Awaited<ReturnType<typeof setup>>['r']) => {
    const all = await r.catalog.listExercises({ includeHidden: true });
    const m = big3Assignments(all);
    const name = (id?: string) => all.find((e) => e.id === id)?.name;
    return { bench: name(m.bench), squat: name(m.squat), deadlift: name(m.deadlift) };
  };
  const outbox = (db: Awaited<ReturnType<typeof setup>>['db']) =>
    db.raw.prepare("SELECT entity_id, fields FROM sync_outbox WHERE entity_type = 'exercise' AND op = 'update' ORDER BY rowid").all()
      .map((x) => { const row = x as { entity_id: string; fields: string }; return [row.entity_id, JSON.parse(row.fields)]; });

  test('割り当てる前は名前で決め、何も保存しない。同じ役を選び直しても書かない', async () => {
    const { db, r } = await setup();
    expect(await roles(r)).toEqual({ bench: 'ベンチプレス', squat: 'スクワット', deadlift: 'デッドリフト' });
    expect((await r.catalog.getExercise(BENCH))?.big3).toBeNull();
    await r.catalog.updateExercise(BENCH, { name: 'ベンチプレス', bodyPartId: CHEST, big3: 'bench' });
    await r.catalog.updateExercise(SEED_EXERCISES[1].id, { name: 'インクラインダンベルプレス', bodyPartId: CHEST, big3: null });
    expect(outbox(db)).toEqual([]);
  });

  test('ほかの種目に付けると前の種目から外し、名前で決めていたほかの役は保存する', async () => {
    const { db, r } = await setup();
    const narrow = await r.catalog.createExercise({ name: 'ナローベンチ', bodyPartId: CHEST, recordType: 'weight_reps', big3: 'bench' });
    expect(await roles(r)).toEqual({ bench: 'ナローベンチ', squat: 'スクワット', deadlift: 'デッドリフト' });
    expect(outbox(db)).toEqual([[SQUAT, { big3: 'squat' }], [DEADLIFT, { big3: 'deadlift' }], [narrow, { big3: 'bench' }]]);
    // 保存した役を別の種目へ：前の種目から外す
    await r.catalog.updateExercise(BENCH, { name: 'ベンチプレス', bodyPartId: CHEST, big3: 'bench' });
    expect(await roles(r)).toEqual({ bench: 'ベンチプレス', squat: 'スクワット', deadlift: 'デッドリフト' });
    expect((await r.catalog.getExercise(narrow))?.big3).toBeNull();
    // 外す
    await r.catalog.updateExercise(DEADLIFT, { name: 'デッドリフト', bodyPartId: SEED_EXERCISES.find((e) => e.id === DEADLIFT)!.bodyPartId, big3: null });
    expect(await roles(r)).toEqual({ bench: 'ベンチプレス', squat: 'スクワット', deadlift: undefined });
  });

  test('割り当てる前に名前の役を外すと、ほかの役は残る', async () => {
    const { r } = await setup();
    await r.catalog.updateExercise(BENCH, { name: 'ベンチプレス', bodyPartId: CHEST, big3: null });
    expect(await roles(r)).toEqual({ bench: undefined, squat: 'スクワット', deadlift: 'デッドリフト' });
  });

  test('フォームの動画のリンク：https:// だけ。空にすると消す。省くと変えない', async () => {
    const { r } = await setup();
    await r.catalog.updateExercise(BENCH, { name: 'ベンチプレス', bodyPartId: CHEST, formVideoUrl: ' https://youtu.be/abc ' });
    expect((await r.catalog.getExercise(BENCH))?.formVideoUrl).toBe('https://youtu.be/abc');
    await r.catalog.updateExercise(BENCH, { name: 'バーベルベンチプレス', bodyPartId: CHEST });
    expect((await r.catalog.getExercise(BENCH))?.formVideoUrl).toBe('https://youtu.be/abc');
    await expect(r.catalog.updateExercise(BENCH, { name: 'ベンチプレス', bodyPartId: CHEST, formVideoUrl: 'http://youtu.be/abc' }))
      .rejects.toThrow('https:// で始まる');
    await expect(r.catalog.createExercise({ name: 'x', bodyPartId: CHEST, recordType: 'weight_reps', formVideoUrl: 'youtu.be/abc' }))
      .rejects.toThrow('https:// で始まる');
    await r.catalog.updateExercise(BENCH, { name: 'ベンチプレス', bodyPartId: CHEST, formVideoUrl: '' });
    expect((await r.catalog.getExercise(BENCH))?.formVideoUrl).toBeNull();
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

  test('過去の日に足すと、その日の記録になり、前回・何種目目はその日を基準にする', async () => {
    const { r } = await setup();
    await r.workouts.saveEntry({ date: '2026-11-01', exerciseId: BENCH, sets: [set(80, 8)] });
    await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: [set(100, 5)] });
    await r.workouts.saveEntry({ date: '2026-11-03', exerciseId: SQUAT, sets: [set(100, 5)] });
    // 今日（11/8）に記録したあとで、過去の日（11/3）に足す
    await r.workouts.saveEntry({ date: '2026-11-03', exerciseId: BENCH, sets: [set(82.5, 6)] });

    expect((await r.workouts.getDay('2026-11-03')).map((e) => [e.exerciseName, e.sortOrder])).toEqual([['スクワット', 0], ['ベンチプレス', 1]]);
    expect((await r.workouts.getDay('2026-11-08')).map((e) => e.sets[0].weightKg)).toEqual([100]);
    // 11/3 の「前回」は 11/1（後の 11/8 ではない）
    expect((await r.workouts.previousEntry(BENCH, '2026-11-03'))?.date).toBe('2026-11-01');
    expect((await r.workouts.previousEntry(BENCH, '2026-11-08'))?.date).toBe('2026-11-03');
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
      { date: '2026-11-08', exerciseId: BENCH, bodyPartId: CHEST, weightKg: 80, reps: 8, bodyweightRatio: null },
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

  test('取り込みだけの値：手入力の行だけの日は null', async () => {
    const { r } = await setup();
    await r.body.saveManual('2026-11-08', { weightKg: 68.4 });
    expect(await r.body.getImportedDay('2026-11-08')).toBeNull();
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
