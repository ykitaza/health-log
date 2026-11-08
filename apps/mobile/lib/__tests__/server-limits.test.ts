// アプリの入れられる範囲が、同期のサーバーの決まり（services/ の pydantic のモデル）と合っていることを確かめる。
// アプリで通った記録を同期で断られないよう、アプリの範囲はサーバーと同じか、その内側にする。
// 値はサーバーのソースから読む（docs/api/app-api.yaml は手で直すことがあり、サーバーと食い違いうるため）
import * as fs from 'fs';
import * as path from 'path';
import { SLEEP_MAX_MIN } from '../healthConnect/importer';
import { LIMITS, MEMO_MAX_LENGTH, NAME_MAX_LENGTH, REPS_MAX } from '../limits';

const root = path.join(__dirname, '..', '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const entities = read('services/training/training/infrastructure/sync_entities.py');
const fields = read('services/sync/sync/fields.py');

/** モデルの中の項目の Field(...) の引数（ge・gt・le・max_length）を読む */
function fieldArgs(source: string, model: string | null, name: string): Record<string, number> {
  const body = model == null ? source : source.split(new RegExp(`^class ${model}\\b.*$`, 'm'))[1]?.split(/^class /m)[0];
  if (body == null) throw new Error(`${model} がない`);
  const line = body.split('\n').find((l) => new RegExp(`^\\s*${name}\\s*[:=]`).test(l));
  if (line == null) throw new Error(`${model}.${name} がない`);
  const args = /Field\(([^)]*)\)/.exec(line)?.[1];
  if (args == null) throw new Error(`${model}.${name} に Field がない: ${line}`);
  return Object.fromEntries(args.split(',').map((a) => a.trim().split('=')).map(([k, v]) => [k, Number(v)]));
}

describe('同期のサーバーの決まりと合っている', () => {
  test('メモ（セットと体組成）は Memo 型。長さの上限が同じ', () => {
    expect(entities).toMatch(/^class WorkoutSetFields[\s\S]*?^\s+memo: Memo = None/m);
    expect(entities).toMatch(/^class BodyRecordFields[\s\S]*?^\s+memo: Memo = None/m);
    expect(fieldArgs(fields, null, 'Memo')).toEqual({ max_length: MEMO_MAX_LENGTH });
  });

  test('回数の上限が同じ。アプリは 1 回から（サーバーは 0 から受ける）', () => {
    const reps = fieldArgs(entities, 'WorkoutSetFields', 'reps');
    expect(reps.le).toBe(REPS_MAX);
    expect(reps.ge).toBeLessThanOrEqual(1);
  });

  test('セットの重量', () => {
    expect(fieldArgs(entities, 'WorkoutSetFields', 'weight_kg')).toEqual({ gt: LIMITS.setWeight.min, le: LIMITS.setWeight.max });
  });

  test('体組成の値', () => {
    const ge = (l: { min: number; max: number }) => ({ ge: l.min, le: l.max });
    expect(fieldArgs(entities, 'BodyRecordFields', 'weight_kg')).toEqual(ge(LIMITS.bodyWeight));
    expect(fieldArgs(entities, 'BodyRecordFields', 'body_fat_pct')).toEqual(ge(LIMITS.bodyFat));
    expect(fieldArgs(entities, 'BodyRecordFields', 'muscle_pct')).toEqual(ge(LIMITS.muscle));
    expect(fieldArgs(entities, 'BodyRecordFields', 'waist_cm')).toEqual(ge(LIMITS.waist));
    expect(fieldArgs(entities, 'BodyRecordFields', 'lean_mass_kg')).toEqual(ge(LIMITS.leanMass));
  });

  test('睡眠の分（Health Connect の取り込み）は、サーバーの上限と同じ', () => {
    expect(entities).toMatch(/^class SleepSessionFields[\s\S]*?^\s+asleep_min: Minutes = None/m);
    expect(entities).toMatch(/^class SleepSessionFields[\s\S]*?^\s+awake_min: Minutes = None/m);
    expect(fieldArgs(entities, null, 'Minutes')).toEqual({ ge: 0, le: SLEEP_MAX_MIN });
  });

  test('種目と部位の名前は、サーバーの上限（コードポイント）の内側', () => {
    expect(entities).toMatch(/^class BodyPartFields[\s\S]*?^\s+name: Name = None/m);
    expect(entities).toMatch(/^class ExerciseFields[\s\S]*?^\s+name: Name = None/m);
    const name = fieldArgs(entities, null, 'Name');
    expect(name.min_length).toBe(1);
    expect(name.max_length).toBeGreaterThanOrEqual(NAME_MAX_LENGTH);
  });

  test('設定の値（身長・目標体重などを文字にしたもの）は、サーバーの上限に収まる', () => {
    const { max_length } = fieldArgs(entities, 'SettingFields', 'value');
    expect(String(-Number.MAX_VALUE).length).toBeLessThanOrEqual(max_length);
  });
});
