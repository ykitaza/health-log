import { lineSummary } from '../chart';

// 線のグラフの読み上げの要約（#323。体重・体組成・心拍）
describe('lineSummary', () => {
  test('題・期間・項目を「、」でつなぐ。空の項目は飛ばす', () => {
    expect(lineSummary('体重', '1か月', ['今 72.4kg', false, '7日の平均 72.8kg', null, '目標 70.0kg']))
      .toBe('体重のグラフ。1か月。今 72.4kg、7日の平均 72.8kg、目標 70.0kg');
  });

  test('項目がなければ、題と期間だけ', () => {
    expect(lineSummary('安静時心拍', '3か月', [undefined, ''])).toBe('安静時心拍のグラフ。3か月');
  });
});
