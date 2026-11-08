import { expect, Locator, Page } from '@playwright/test';

/** テストの「今日」。2026-11-08 は日曜（週は日曜始まり） */
export const TODAY = '2026-11-08';

export type SetSpec = { weight?: string; reps?: string; memo?: string; done?: boolean };

/** 端末の時刻を、その日の日本時間の朝 10 時に固定する */
export async function setDate(page: Page, date: string) {
  await page.clock.setFixedTime(new Date(`${date}T10:00:00+09:00`));
}

/** 日付を固定してホームを開く。新しいコンテキストなので、データはまっさら */
export async function openApp(page: Page, date = TODAY) {
  await setDate(page, date);
  await page.goto('/');
  await expect(see(page, 'トレログ', { exact: true })).toBeVisible();
}

/** 日付を変えて、ホームを開き直す（保存したデータは残る） */
export async function moveToDate(page: Page, date: string) {
  await setDate(page, date);
  await page.goto('/');
  await expect(see(page, 'トレログ', { exact: true })).toBeVisible();
}

export const tab = (page: Page, name: 'ホーム' | '食事' | '履歴／分析' | '体組成') => page.getByRole('tab', { name });

/** タブを切り替える。前のタブが隠れる（aria-hidden になる）まで待つ */
export async function goTab(page: Page, name: 'ホーム' | '食事' | '履歴／分析' | '体組成') {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '設定', exact: true })).toHaveCount(name === 'ホーム' || name === '体組成' ? 1 : 0);
}

/** 見えているボタン（画面の切り替わりの途中は、前の画面のボタンも残っている） */
export const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true }).filter({ visible: true });

/** 種目の選択の画面で、種目の行を押す */
export async function chooseExercise(page: Page, name: string) {
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`^${name} `) }).click();
  // 記録の入力の画面は、読み込みが終わってから見出しと保存のボタンが出る
  await expect(saveButton(page)).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`^${name} `) })).toBeHidden();
}

/** 記録の入力の画面で、セットを埋める（足りなければ「セットを追加」する） */
export async function fillSets(page: Page, sets: SetSpec[]) {
  for (const [i, s] of sets.entries()) {
    const n = i + 1;
    if ((await page.getByLabel(`セット${n}の回数`, { exact: true }).count()) === 0) {
      await button(page, 'セットを追加').click();
    }
    if (s.weight !== undefined) await page.getByLabel(`セット${n}の重量`, { exact: true }).fill(s.weight);
    if (s.reps !== undefined) await page.getByLabel(`セット${n}の回数`, { exact: true }).fill(s.reps);
    if (s.memo !== undefined) await page.getByLabel(`セット${n}のメモ`, { exact: true }).fill(s.memo);
    if (s.done) await page.getByRole('checkbox', { name: `セット${n}の完了` }).click();
  }
}

/** 記録の入力の画面の、保存のボタン（「今日のトレーニングに追加」など） */
export const saveButton = (page: Page) =>
  page.getByRole('button', { name: /^(今日のトレーニングに追加|この日のトレーニングに追加|変更を保存)$/ }).filter({ visible: true });

/** その日のトレーニングの画面から、種目を1つ記録する */
export async function addEntry(page: Page, exercise: string, sets: SetSpec[]) {
  await button(page, '種目を追加').click();
  await chooseExercise(page, exercise);
  await fillSets(page, sets);
  await saveButton(page).click();
  await expect(page.getByRole('button', { name: `${exercise}を直す` })).toBeVisible();
}

/** ホームから、今日の記録を足してホームに戻る */
export async function recordToday(page: Page, entries: { exercise: string; sets: SetSpec[] }[]) {
  await button(page, '本日のトレーニングを追加').click();
  await expect(see(page, '今日のトレーニング', { exact: true })).toBeVisible();
  for (const e of entries) await addEntry(page, e.exercise, e.sets);
  await button(page, '戻る').click();
  await expect(see(page, '今日の記録', { exact: true })).toBeVisible();
}

/** その日を「今日」にして記録する（過去の日の記録を、画面の操作だけで作る） */
export async function recordOn(page: Page, date: string, entries: { exercise: string; sets: SetSpec[] }[]) {
  await moveToDate(page, date);
  await recordToday(page, entries);
}

/** 設定の画面を開く（ホームの歯車から） */
export async function openSettings(page: Page) {
  await button(page, '設定').click();
  await expect(see(page, '重さの単位', { exact: true })).toBeVisible();
}

/** 重さの単位を変える（設定の画面で） */
export async function chooseUnit(page: Page, unit: 'kg' | 'lb') {
  await button(page, unit).click();
  await expect(button(page, unit)).toHaveAttribute('aria-selected', 'true');
}

/**
 * 見えている文字。前の画面（スタックの下の画面）やほかのタブも DOM に残っている。
 * ほかのタブは aria-hidden="true" のまま、今のタブの後ろに重なっているので、
 * 見えているもの（visible）のうち、aria-hidden の中にないものだけに絞る
 */
export const see = (scope: Page | Locator, text: string | RegExp, opts?: { exact?: boolean }) => {
  const page = 'page' in scope ? scope.page() : scope;
  return scope.getByText(text, opts).filter({ visible: true }).and(page.locator(':not([aria-hidden="true"] *)'));
};

/** 入力欄に入れて、欄を離れる（体組成と設定は、欄を離れたときに保存する） */
export async function enter(page: Page, label: string, value: string) {
  const input = page.getByRole('textbox', { name: label, exact: true }).filter({ visible: true });
  await input.fill(value);
  await input.press('Tab');
}

/** ホームから体組成のタブを開く */
export async function openBody(page: Page) {
  await goTab(page, '体組成');
  await expect(see(page, '自動で計算', { exact: false }).first()).toBeVisible();
}

/** 設定（ホームか体組成の歯車から）で身長・目標体重を入れて、元の画面に戻る */
export async function setBodyInfo(page: Page, info: { height?: string; goal?: string }) {
  await openSettings(page);
  if (info.height !== undefined) await enter(page, '身長', info.height);
  if (info.goal !== undefined) await enter(page, '目標体重', info.goal);
  await button(page, '戻る').click();
}
