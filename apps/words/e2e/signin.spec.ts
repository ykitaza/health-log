import { expect, test } from '@playwright/test';
import { button, byTest, createFakeSyncServer, goTab, mcpExpression, setNow, signedInWith } from './helpers';
import { fakeCognito, fakeLoginPopup } from './login';

// ログイン（偽の Cognito。本物には当てない）と、同期で Claude が拾った言葉が届く流れ

test('ログインに失敗したら案内を出す。ログインせずにも使える', async ({ page, context }) => {
  await fakeCognito(context, { status: 400, body: { error: 'invalid_grant' } });
  await fakeLoginPopup(page, { code: 'bad' });
  await setNow(page);
  await page.goto('/');
  await expect(byTest(page, 'welcome-screen')).toContainText('KARADA と同じアカウント');
  await byTest(page, 'signin').click();
  await expect(byTest(page, 'signin-error')).toHaveText('ログインできませんでした。もう一度ログインしてください。');
  await expect(byTest(page, 'signin')).toHaveText('もう一度ログイン');
  await byTest(page, 'skip-signin').click();
  await expect(byTest(page, 'home-screen')).toBeVisible();
});

test('ログインのサーバーにつながらないときは、その案内を出す', async ({ page, context }) => {
  await fakeCognito(context);
  await fakeLoginPopup(page, { code: 'c' });
  await setNow(page);
  await page.goto('/');
  await byTest(page, 'signin').click();
  await expect(byTest(page, 'signin-error')).toHaveText('ログインのサーバーにつながりませんでした。通信を確かめて、もう一度ログインしてください。');
});

test('ログインすると同期し、Claude が拾った言葉と例文・タグの案が届く。案はワンタップで確かめ、送る', async ({ page, context }) => {
  const server = createFakeSyncServer();
  const id = mcpExpression(server, 1, {
    text: '腑に落ちる', reading: 'ふにおちる', meaning: '説明や出来事に、心から納得する', scene: '先輩の説明を聞いて納得する場面',
    examples: ['先輩のひと言で、ようやく腑に落ちた。'], tag: { id: 'c017b117-0d7d-5e2e-86e8-8b3c9590f92f', status: 'proposed' },
    source_id: 'a109a3dc-f225-52aa-bf2d-ecb3e3b3640d', title: '舟を編む', surrounding_text: '彼はようやく腑に落ちたという顔をした。', wording: '腑に落ちた',
  });
  await signedInWith(page, context, server);
  await setNow(page);
  await page.goto('/');
  await byTest(page, 'signin').click();
  await expect(byTest(page, 'home-screen')).toBeVisible();
  await expect(byTest(page, 'recent-row').first()).toContainText('腑に落ちる');
  await expect(byTest(page, 'recent-row').first()).toContainText('Claude から');

  await byTest(page, 'recent-row').first().click();
  await expect(byTest(page, 'word-meaning')).toHaveText('説明や出来事に、心から納得する');
  const example = byTest(page, 'example-row');
  await expect(example).toContainText('Claude の案（タップで確かめる）');
  await example.getByRole('button').click();
  await expect(example).not.toContainText('タップで確かめる');
  await byTest(page, 'tag-雑談で').click();
  await expect(byTest(page, 'tag-雑談で')).toHaveAccessibleName(/Claude が付けて、確かめた/);

  // 確かめたことがサーバーに届く（例文は表現の examples の一覧ごと、タグはつながりの status）
  type Posted = { entity_type: string; op: string; fields?: { examples?: { confirmed: boolean }[]; status?: string } };
  await expect.poll(() => {
    const posted = server.requests.filter((r) => r.method === 'POST').flatMap((r) => (r.body as { changes: Posted[] }).changes);
    return {
      example: posted.some((c) => c.entity_type === 'expression' && c.fields?.examples?.[0]?.confirmed === true),
      tag: posted.some((c) => c.entity_type === 'expression_tag' && c.fields?.status === 'confirmed'),
    };
  }, { timeout: 15_000 }).toEqual({ example: true, tag: true });
  expect(id).toMatch(/^a0000000/);

  // アカウントの画面（拾った → … → 設定 → アカウント。web のログインはメモリーにだけあるので、読み込み直さない）
  await button(page, '戻る').click();
  await goTab(page, 'collected');
  await byTest(page, 'open-menu').click();
  await byTest(page, 'open-settings').click();
  await byTest(page, 'settings-account').click();
  await expect(byTest(page, 'account-status')).toHaveText('ログインしています');
  await expect(byTest(page, 'sync-pending')).toHaveText('0件');
});
