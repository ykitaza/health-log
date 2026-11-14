// アプリの入れられる範囲が、同期のサーバーの決まり（services/ の pydantic のモデル）と合っていることを確かめる。
// アプリで通った記録を同期で断られないよう、アプリの範囲はサーバーと同じか、その内側にする。
// 値はサーバーのソースから読む（docs/api/app-api.yaml は手で直すことがあり、サーバーと食い違いうるため）
import * as fs from 'fs';
import * as path from 'path';
import { BPM_MAX, BPM_MIN, SLEEP_MAX_MIN, STEPS_MAX, STEPS_MIN } from '../healthConnect/importer';
import { SITE_CODES, SITES } from '../injuries';
import { MIN_WEIGH_INS, PACE_BAND_CENTS, PACE_WINDOW_DAYS, PHASE_LIMITS, RECOVERY_DAYS } from '../phases';
import { BIG3_END_DAYS } from '../phaseView';
import { FORM_VIDEO_URL_MAX_LENGTH, FORM_VIDEO_URL_PATTERN, INJURY_LIMITS, LIMITS, MEMO_MAX_LENGTH, NAME_MAX_LENGTH, REPS_MAX } from '../limits';

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
  test('フォームの動画のリンク：長さの上限と形（pattern）が同じ。種目の項目は FormVideoUrl 型', () => {
    const m = /^FormVideoUrl = Annotated\[str, Field\(max_length=(\d+), pattern=r"(.+)"\)\]$/m.exec(entities);
    expect(m?.slice(1)).toEqual([String(FORM_VIDEO_URL_MAX_LENGTH), FORM_VIDEO_URL_PATTERN.source.replace(/\\\//g, '/')]);
    expect(entities).toMatch(/^class ExerciseFields[\s\S]*?^\s+form_video_url: FormVideoUrl \| None = None/m);
    expect(entities).toMatch(/^class ExerciseFields[\s\S]*?^\s+big3: Literal\["bench", "squat", "deadlift"\] \| None = None/m);
  });

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
    expect(fieldArgs(entities, 'BodyRecordFields', 'lean_mass_kg')).toEqual(ge(LIMITS.leanMass));
  });

  test('睡眠の分（Health Connect の取り込み）は、サーバーの上限と同じ', () => {
    expect(entities).toMatch(/^class SleepSessionFields[\s\S]*?^\s+asleep_min: Minutes = None/m);
    expect(entities).toMatch(/^class SleepSessionFields[\s\S]*?^\s+awake_min: Minutes = None/m);
    expect(fieldArgs(entities, null, 'Minutes')).toEqual({ ge: 0, le: SLEEP_MAX_MIN });
  });

  test('心拍の日のまとめの範囲は、サーバーと同じ', () => {
    expect(fieldArgs(entities, null, 'Bpm')).toEqual({ ge: BPM_MIN, le: BPM_MAX });
    for (const f of ['resting_bpm', 'avg_bpm', 'min_bpm', 'max_bpm']) {
      expect(entities).toMatch(new RegExp(`^class HeartRateDayFields[\\s\\S]*?^\\s+${f}: Bpm \\| None = None`, 'm'));
    }
  });

  test('歩数の日の合計の範囲は、サーバーと同じ', () => {
    expect(fieldArgs(entities, null, 'StepCount')).toEqual({ ge: STEPS_MIN, le: STEPS_MAX });
    expect(entities).toMatch(/^class StepDayFields[\s\S]*?^\s+steps: StepCount = None/m);
  });

  test('種目と部位の名前は、サーバーの上限（コードポイント）の内側', () => {
    expect(entities).toMatch(/^class BodyPartFields[\s\S]*?^\s+name: Name = None/m);
    expect(entities).toMatch(/^class ExerciseFields[\s\S]*?^\s+name: Name = None/m);
    const name = fieldArgs(entities, null, 'Name');
    expect(name.min_length).toBe(1);
    expect(name.max_length).toBeGreaterThanOrEqual(NAME_MAX_LENGTH);
  });

  test('ケガの記録の上限（場面・症状・原因・直し方・振り返りのメモ、件数）は、サーバーの injury.py と同じ', () => {
    const injury = read('services/training/training/domain/injury.py');
    const constant = (name: string) => {
      const m = new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(injury);
      if (!m) throw new Error(`${name} がない`);
      return Number(m[1]);
    };
    expect({
      phase: constant('MAX_PHASE'), symptom: constant('MAX_SYMPTOM'), cause: constant('MAX_CAUSE'), fix: constant('MAX_FIX'),
      reviewNote: constant('MAX_REVIEW_NOTE'), injuries: constant('MAX_INJURIES'), reviewsPerInjury: constant('MAX_REVIEWS_PER_INJURY'),
    }).toEqual(INJURY_LIMITS);
    // 振り返りの終わりの BIG3 を見る日数（training.domain.measures）
    expect(Number(/^BIG3_END_DAYS = (\d+)/m.exec(read('services/training/training/domain/measures.py'))?.[1])).toBe(BIG3_END_DAYS);
    // 同期の項目も同じ定数を使う（Field(max_length=MAX_…)）
    for (const [field, name] of [['phase', 'MAX_PHASE'], ['symptom', 'MAX_SYMPTOM'], ['cause', 'MAX_CAUSE'], ['fix', 'MAX_FIX']]) {
      expect(entities).toMatch(new RegExp(`^class InjuryFields[\\s\\S]*?^\\s+${field}: Annotated\\[str, Field\\(max_length=${name}\\)\\]`, 'm'));
    }
    expect(entities).toMatch(/^class InjuryReviewFields[\s\S]*?^\s+note: Annotated\[str, Field\(max_length=MAX_REVIEW_NOTE\)\]/m);
  });

  test('ケガの部位のコード・名前・左右の有無は、サーバーの SITES と同じ', () => {
    const injury = read('services/training/training/domain/injury.py');
    const server = [...injury.matchAll(/^\s+"(\w+)": Site\("([^"]+)", "(muscle|joint)", (True|False)\),$/gm)]
      .map(([, code, name, kind, sided]) => ({ code, name, kind, sided: sided === 'True' }));
    expect(server.length).toBeGreaterThan(0);
    expect(SITE_CODES.map((code) => ({ code, name: SITES[code].name, kind: SITES[code].kind, sided: SITES[code].sided }))).toEqual(server);
  });

  test('フェーズの上限とペースの決まり（幅・測った日・7日・戻って14日）は、サーバーの phase.py と同じ', () => {
    const phase = read('services/training/training/domain/phase.py');
    const constant = (name: string) => {
      const m = new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(phase);
      if (!m) throw new Error(`${name} がない`);
      return Number(m[1]);
    };
    expect({
      name: constant('MAX_NAME'), weeks: constant('MAX_WEEKS'), targetHistory: constant('MAX_TARGET_HISTORY'), phases: constant('MAX_PHASES'),
    }).toEqual(PHASE_LIMITS);
    expect([constant('PACE_BAND_CENTS'), constant('MIN_WEIGH_INS'), constant('PACE_WINDOW_DAYS'), constant('RECOVERY_DAYS')])
      .toEqual([PACE_BAND_CENTS, MIN_WEIGH_INS, PACE_WINDOW_DAYS, RECOVERY_DAYS]);
    // 振り返りの終わりの BIG3 を見る日数（training.domain.measures）
    expect(Number(/^BIG3_END_DAYS = (\d+)/m.exec(read('services/training/training/domain/measures.py'))?.[1])).toBe(BIG3_END_DAYS);
    // 同期の項目も同じ定数を使う
    expect(entities).toMatch(/^class PhaseFields[\s\S]*?^\s+name: Annotated\[str, Field\(max_length=MAX_PHASE_NAME\)\]/m);
    expect(entities).toMatch(/^class PhaseFields[\s\S]*?^\s+target_history: Annotated\[list\[PhaseTargetChange\], Field\(max_length=MAX_TARGET_HISTORY\)\]/m);
  });

  test('設定の値（身長・目標体重などを文字にしたもの）は、サーバーの上限に収まる', () => {
    const { max_length } = fieldArgs(entities, 'SettingFields', 'value');
    expect(String(-Number.MAX_VALUE).length).toBeLessThanOrEqual(max_length);
  });
});
