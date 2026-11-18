import { changedDigits } from '../digits';

describe('数字の桁の入れ替え（どの桁が変わったか）', () => {
  test('初めて出すときは、どの桁も動かさない', () => {
    expect(changedDigits(undefined, '1,234')).toEqual([false, false, false, false, false]);
  });

  test('同じ値なら、どの桁も動かさない', () => {
    expect(changedDigits('12.5', '12.5')).toEqual([false, false, false, false]);
  });

  test('いちばん下の位だけ変わったら、そこだけ', () => {
    expect(changedDigits('1.2', '1.3')).toEqual([false, false, true]);
  });

  test('繰り上がりで変わった桁はすべて', () => {
    expect(changedDigits('1,199', '1,200')).toEqual([false, false, true, true, true]);
  });

  test('桁が増えたら、右からそろえて比べ、増えた左の桁も変わったものとする', () => {
    expect(changedDigits('9.9', '10.0')).toEqual([true, true, false, true]);
    expect(changedDigits('980', '1,020')).toEqual([true, true, true, true, false]);
  });

  test('桁が減ったら、右からそろえて比べる', () => {
    expect(changedDigits('1,020', '980')).toEqual([true, true, false]);
  });

  test('小数点や区切りの位置が同じなら、その文字は動かさない', () => {
    expect(changedDigits('61.5', '60.8')).toEqual([false, true, false, true]);
    expect(changedDigits('−0.4', '+0.4')).toEqual([true, false, false, false]);
  });
});
