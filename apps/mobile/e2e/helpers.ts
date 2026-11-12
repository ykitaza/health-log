import { expect, Locator, Page } from '@playwright/test';

/** テストの「今日」。2026-11-08 は日曜（週は月曜始まりなので、11/2〜11/8 が今週。カレンダーは日曜始まり） */
export const TODAY = '2026-11-08';

export type SetSpec = { weight?: string; reps?: string; memo?: string; done?: boolean };

/** 端末の時刻を、その日の日本時間の朝 10 時に固定する */
export async function setDate(page: Page, date: string) {
  await page.clock.setFixedTime(new Date(`${date}T10:00:00+09:00`));
}

/** ホームのいちばん上（形の段）の左のアカウントの写真（なければアプリのアイコン）。ホームが出ていることを確かめるのに使う */
export const homeIcon = (page: Page) => page.getByTestId('home-account').filter({ visible: true });

/** 日付を固定してホームを開く。新しいコンテキストなので、データはまっさら */
export async function openApp(page: Page, date = TODAY) {
  await setDate(page, date);
  await page.goto('/');
  await expect(homeIcon(page)).toBeVisible();
}

/** 日付を変えて、ホームを開き直す（保存したデータは残る） */
export async function moveToDate(page: Page, date: string) {
  await setDate(page, date);
  await page.goto('/');
  await expect(homeIcon(page)).toBeVisible();
}

export type TabName = 'ホーム' | '筋トレ' | '食事' | 'からだ' | 'レポート';
// 画面の上の切り替え（primary tabs。レポートのタブの「レポート ／ やること」など）は数えない
export const tab = (page: Page, name: TabName) =>
  page.getByRole('tab', { name, exact: true }).and(page.locator(':not([data-testid="primary-tabs"] *)'));
/** 画面の上の切り替え（primary tabs）の、見えているもの */
export const primaryTab = (page: Page, name: string) =>
  page.getByTestId('primary-tabs').filter({ visible: true }).getByRole('tab', { name, exact: true });

/** タブを切り替える。前のタブが隠れる（aria-hidden になる）まで待つ */
export async function goTab(page: Page, name: TabName) {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
  // 設定の歯車はどのタブにもある（隠れたタブのものは数えない）
  await expect(button(page, '設定')).toHaveCount(1);
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

/** ホームの「記録する」のシートを開き、行（筋トレ・食事・体重・AI で記録）を押す */
export async function recordFromHome(page: Page, row: 'training' | 'meal' | 'body' | 'ai') {
  await button(page, '記録する').click();
  await expect(page.getByTestId('record-sheet')).toBeVisible();
  await page.getByTestId(`record-${row}`).click();
}

/** 筋トレのタブの「記録」が、その日（「11月8日（日）」など）を出すまで待つ */
export async function expectTrainingDay(page: Page, label: string) {
  await expect(tab(page, '筋トレ')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '記録', exact: true }).filter({ visible: true })).toHaveAttribute('aria-selected', 'true');
  await expect(button(page, `日を選ぶ（${label}）`)).toBeVisible();
}

/** ホームから、今日の記録を足してホームに戻る（「記録する」の筋トレで、筋トレのタブの「記録」の今日が開く） */
export async function recordToday(page: Page, entries: { exercise: string; sets: SetSpec[] }[]) {
  await recordFromHome(page, 'training');
  await expect(tab(page, '筋トレ')).toHaveAttribute('aria-selected', 'true');
  await expect(button(page, '前の日')).toBeVisible();
  for (const e of entries) await addEntry(page, e.exercise, e.sets);
  await goTab(page, 'ホーム');
  await expect(homeCard(page, 'training')).toBeVisible();
}

/** その日を「今日」にして記録する（過去の日の記録を、画面の操作だけで作る） */
export async function recordOn(page: Page, date: string, entries: { exercise: string; sets: SetSpec[] }[]) {
  await moveToDate(page, date);
  await recordToday(page, entries);
}

/** 設定の画面を開く（ホームか体組成の歯車から） */
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

/**
 * DB の返事（expo-sqlite の web の worker から画面への返事）を、止めたり流したりできるようにする。openApp の前に呼ぶ。
 * hold() のあとの返事は止めておき、release() で届いた順に流す。保存と読み直しの完了を、画面の操作のあとまで遅らせて確かめるため
 */
export async function controlDb(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __dbHeld: (() => void)[] | null };
    w.__dbHeld = null;
    const Original = window.Worker;
    window.Worker = class extends Original {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
        if (type !== 'message' || typeof listener !== 'function') return super.addEventListener(type, listener, options);
        super.addEventListener(type, (e) => {
          if (w.__dbHeld) w.__dbHeld.push(() => listener.call(this, e));
          else listener.call(this, e);
        }, options);
      }
    };
  });
  return {
    hold: () => page.evaluate(() => { (window as unknown as { __dbHeld: (() => void)[] | null }).__dbHeld = []; }),
    release: () => page.evaluate(() => {
      const w = window as unknown as { __dbHeld: (() => void)[] | null };
      const held = w.__dbHeld ?? [];
      w.__dbHeld = null;
      for (const f of held) f();
    }),
  };
}

/** ホームの小さなカード（今日のトレーニング・食事・体調） */
export const homeCard = (page: Page, which: 'training' | 'meals' | 'condition') => page.getByTestId(`home-${which}`).filter({ visible: true });

/** タブの中の切り替え（筋トレの「記録」「推移」「ケガ」、食事の「記録」「推移」、からだの「今日」「推移」） */
export async function goPane(page: Page, name: '今日' | '記録' | '推移' | 'ケガ') {
  const t = page.getByRole('tab', { name, exact: true }).filter({ visible: true });
  await t.click();
  await expect(t).toHaveAttribute('aria-selected', 'true');
}

/** 筋トレのタブの「推移」を開く（グラフと、種目を選んだときの記録のカード） */
export async function openTrainingTrend(page: Page) {
  await goTab(page, '筋トレ');
  await goPane(page, '推移');
}

/** 推移で種目を選んだときの、その日の記録のカード */
export const trendDay = (page: Page, date: string) => page.getByTestId(`trend-day-${date}`).filter({ visible: true });

/** 筋トレのタブの右上の入口から RM計算機を開く */
export async function openRm(page: Page) {
  await goTab(page, '筋トレ');
  await button(page, 'RM計算機').click();
  await expect(see(page, 'RM計算機', { exact: true })).toBeVisible();
}

/**
 * 左右にスワイプする（指を右へ動かすと前、左へ動かすと次）。scope の中ほどから、横に 160 動かす。
 * dy を渡すと縦にも動かす（縦のスクロールではスワイプにならないことを確かめる）
 */
export async function swipe(scope: Locator, direction: 'prev' | 'next', dy = 0) {
  const box = await scope.boundingBox();
  if (!box) throw new Error('スワイプする範囲が見えていません');
  const page = scope.page();
  // web ではマウスで引くと文字が選ばれ、react-native-web は選ばれた時点で指の操作を打ち切る（Android の指では起きない）。
  // スワイプを使うページでは、文字を選べなくする
  await page.addStyleTag({ content: '* { user-select: none !important; -webkit-user-select: none !important; }' });
  const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 200);
  const dx = direction === 'prev' ? 160 : -160;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

/** 食事のタブの「推移」（週のまとめ）を開く（前の履歴／分析のタブの食事） */
export async function openMealWeek(page: Page) {
  await goTab(page, '食事');
  await goPane(page, '推移');
}

/** からだのタブの「今日」を開く */
export async function openBody(page: Page) {
  await goTab(page, 'からだ');
  await goPane(page, '今日');
  await expect(button(page, '前の日')).toBeVisible();
}

/** からだの今日で、計測を入れるシートを開く（記録がある日は「入力・編集」、ない日は「計測を入れる」） */
export async function openBodySheet(page: Page) {
  await page.getByRole('button', { name: /^(入力・編集|計測を入れる)$/ }).filter({ visible: true }).click();
  await expect(page.getByRole('textbox', { name: '体重', exact: true })).toBeVisible();
}

/** 計測を入れるシートで値を入れて保存し、シートが閉じるのを待つ（渡さなかった欄はそのまま。'' は欄を空にする） */
export async function enterBody(page: Page, values: { weight?: string; bodyFat?: string; memo?: string }) {
  await openBodySheet(page);
  const fill = (label: string, v?: string) => (v === undefined ? null : page.getByRole('textbox', { name: label, exact: true }).fill(v));
  await fill('体重', values.weight);
  await fill('体脂肪率', values.bodyFat);
  await fill('体組成のメモ', values.memo);
  await button(page, '保存').click();
  await expect(page.getByRole('textbox', { name: '体重', exact: true })).toBeHidden();
}

/** 設定（どのタブの歯車からでも）の「アカウント」の行から、アカウントの画面を開く */
export async function openAccountFromSettings(page: Page) {
  await openSettings(page);
  await page.getByTestId('settings-account').filter({ visible: true }).click();
  await expect(see(page, 'プロフィール', { exact: true })).toBeVisible();
}

/** アカウントの画面（設定から）で身長・目標体重を入れて、元の画面に戻る */
export async function setBodyInfo(page: Page, info: { height?: string; goal?: string }) {
  await openAccountFromSettings(page);
  if (info.height !== undefined) await enter(page, '身長', info.height);
  if (info.goal !== undefined) await enter(page, '目標体重', info.goal);
  await button(page, '戻る').click();
  await button(page, '戻る').click();
}
