// 食事の入れられる範囲と区分などが、サーバーの決まり（services/meals のソース）と同じであることを確かめる。
// アプリで通った記録を、同期で断られないようにするため。値はサーバーのソースから読む
import * as fs from 'fs';
import * as path from 'path';
import {
  AMOUNT_MAX, BODY_WEIGHT_MAX, DESCRIPTION_MAX, GRAMS_MAX, ITEM_NAME_MAX, KCAL_MAX, MAX_ITEMS, PROTEIN_PER_KG_MAX,
  SLOTS, TARGET_WEIGHT, TEMPLATE_NAME_MAX, UNITS,
} from '../meals';

const root = path.join(__dirname, '..', '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const entities = read('services/meals/meals/infrastructure/sync_entities.py');
const meal = read('services/meals/meals/domain/meal.py');
const values = read('services/meals/meals/domain/values.py');

/** `Name = Annotated[float, Field(ge=0, le=5000)]` や、モデルの中の `name: Annotated[..., Field(...)]` の引数 */
function fieldArgs(source: string, name: string): Record<string, number> {
  const line = source.split('\n').find((l) => new RegExp(`^\\s*${name}\\s*[:=]`).test(l));
  const args = line && /Field\(([^)]*)\)/.exec(line)?.[1];
  if (!args) throw new Error(`${name} に Field がない`);
  return Object.fromEntries(args.split(',').map((a) => a.trim().split('=')).map(([k, v]) => [k, Number(v)]));
}

describe('食事のサーバーの決まりと合っている', () => {
  test('品目は1回の食事に50件まで', () => {
    expect(meal).toMatch(new RegExp(`^MAX_ITEMS = ${MAX_ITEMS}$`, 'm'));
  });

  test('区分の名前と順番、単位', () => {
    const slots = [...values.matchAll(/^\s+(BREAKFAST|LUNCH|DINNER|SNACK) = "(\w+)"/gm)].map((m) => m[2]);
    expect(slots).toEqual(SLOTS);
    expect(entities).toContain(`Unit = Literal[${UNITS.map((u) => `"${u}"`).join(', ')}]`);
  });

  test('品目の値の範囲', () => {
    expect(fieldArgs(entities, 'Grams')).toEqual({ ge: 0, le: GRAMS_MAX });
    expect(fieldArgs(entities, 'Kcal')).toEqual({ ge: 0, le: KCAL_MAX });
    expect(fieldArgs(entities, 'Amount')).toEqual({ gt: 0, le: AMOUNT_MAX });
    expect(fieldArgs(entities, 'ItemName')).toEqual({ min_length: 1, max_length: ITEM_NAME_MAX });
    expect(fieldArgs(entities, 'TemplateName')).toEqual({ min_length: 1, max_length: TEMPLATE_NAME_MAX });
    expect(fieldArgs(entities, 'description')).toEqual({ max_length: DESCRIPTION_MAX });
  });

  test('目標の値の範囲', () => {
    expect(fieldArgs(entities, 'body_weight_kg')).toEqual({ gt: 0, le: BODY_WEIGHT_MAX });
    expect(fieldArgs(entities, 'protein_per_kg')).toEqual({ gt: 0, le: PROTEIN_PER_KG_MAX });
    expect(fieldArgs(entities, 'target_weight_kg')).toEqual({ ge: TARGET_WEIGHT.min, le: TARGET_WEIGHT.max });
  });
});
