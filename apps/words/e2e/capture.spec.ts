import { expect, test } from '@playwright/test';
import { button, byTest, capture, goTab, openApp } from './helpers';

// 書き留める → 拾った → 言葉の詳細 → 手札・使えた、の流れ。計算と決まりの場合分けは jest

test('拾うと、さっき拾ったと拾ったの一覧に出て、詳細に例文（自分）と出どころが出る', async ({ page }) => {
  await openApp(page);
  await capture(page, { text: '肩の荷が下りる', source: 'Audible', title: '街とその不確かな壁', scene: '役目を譲った場面の、ほっとした感じ', example: '発表が終わって、肩の荷が下りた。' });
  await expect(byTest(page, 'capture-notice')).toHaveText('拾いました');
  await expect(byTest(page, 'recent-row').first()).toContainText('肩の荷が下りる');
  await expect(byTest(page, 'recent-row').first()).toContainText('Audible');
  // 入力は空に戻り、場所と題は残る（続けて拾える）
  await expect(byTest(page, 'capture-text')).toHaveValue('');
  await expect(byTest(page, 'capture-title')).toHaveValue('街とその不確かな壁');

  await goTab(page, 'collected');
  await expect(byTest(page, 'collected-group').first()).toContainText('『街とその不確かな壁』');
  await byTest(page, 'word-row').first().click();
  await expect(byTest(page, 'word-text')).toHaveText('肩の荷が下りる');
  await expect(byTest(page, 'word-scene')).toHaveText('役目を譲った場面の、ほっとした感じ');
  await expect(byTest(page, 'example-row')).toContainText('発表が終わって、肩の荷が下りた。');
  await expect(byTest(page, 'example-row')).toContainText('自分');

  // 例文を足す
  await byTest(page, 'example-input').fill('役目を終えて肩の荷が下りる');
  await byTest(page, 'example-save').click();
  await expect(byTest(page, 'example-row')).toHaveCount(2);
});

test('同じ表現をもう一度拾うと、また出会ったとして手札に入る。手札から使えたを押すと落款が押され、記録に出る', async ({ page }) => {
  await openApp(page);
  await capture(page, { text: '腑に落ちる', source: 'Kindle', title: '舟を編む' });
  await byTest(page, 'capture-text').fill('「腑に落ちる」');
  await expect(byTest(page, 'capture-matches')).toContainText('同じ表現があります');
  await byTest(page, 'capture-save').click();
  await expect(byTest(page, 'capture-notice')).toHaveText('また出会ったので、手札に入れました');

  await goTab(page, 'hand');
  await expect(byTest(page, 'hand-screen')).toContainText('1 / 10');
  await expect(byTest(page, 'hand-card')).toContainText('意味がわかる');
  await expect(byTest(page, 'hand-empty')).toHaveCount(9);
  await byTest(page, 'hand-card').click();
  await expect(byTest(page, 'word-meta')).toContainText('2 回出会った');
  await byTest(page, 'used').click();
  await expect(byTest(page, 'seal')).toBeVisible();
  await expect(byTest(page, 'word-notice')).toHaveText('使えた、を記録しました');
  await button(page, '戻る').click();

  await goTab(page, 'collected');
  await byTest(page, 'collected-settings').click();
  await byTest(page, 'settings-records').click();
  await expect(byTest(page, 'records-uses')).toHaveText('使えた 1 回 · 自分の言葉 0 語');
  await expect(byTest(page, 'records-seals')).toContainText('腑に落ちる');
  await expect(byTest(page, 'records-lead')).toHaveText('今週は 1 語。これまでに 1 語、拾っています');
  await expect(byTest(page, 'records-sources')).toContainText('Kindle');
});

test('手札は10枚まで。いっぱいなら拾ったに入れて知らせる。拾ったの★で絞れる', async ({ page }) => {
  await openApp(page);
  for (let i = 1; i <= 10; i++) await capture(page, { text: `言葉${i}`, want: true });
  await capture(page, { text: '十一枚目', want: true });
  await expect(byTest(page, 'capture-notice')).toHaveText('手札がいっぱいなので、拾ったに入れました');
  await goTab(page, 'hand');
  await expect(byTest(page, 'hand-card')).toHaveCount(10);
  await expect(byTest(page, 'hand-empty')).toHaveCount(0);

  await goTab(page, 'collected');
  await button(page, '十一枚目').click();
  await byTest(page, 'word-star').click();
  await expect(byTest(page, 'to-hand')).toBeDisabled();
  await button(page, '戻る').click();
  await byTest(page, 'filter-star').click();
  await expect(byTest(page, 'word-row')).toHaveCount(1);
});
