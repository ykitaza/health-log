import { ApiError, createApiClient } from '../api';

describe('POST /v1/audio に間（pause）を付ける', () => {
  function setup(statuses: number[]) {
    const bodies: unknown[] = [];
    const fetch = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const status = statuses[bodies.length - 1] ?? 200;
      return { status, ok: status < 300, arrayBuffer: async () => new Uint8Array([1]).buffer };
    }) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ baseUrl: 'https://x', getAccessToken: async () => 'tok', fetch });
    return { api, bodies };
  }

  it('ふつうは付けない（古いサーバーでも同じ 800ms）。短い・長いは付ける', async () => {
    const t = setup([]);
    await t.api.audio('a');
    await t.api.audio('a', 'normal');
    await t.api.audio('a', 'short');
    await t.api.audio('a', 'long');
    expect(t.bodies).toEqual([
      { expression_id: 'a' }, { expression_id: 'a' },
      { expression_id: 'a', pause: 'short' }, { expression_id: 'a', pause: 'long' },
    ]);
  });

  it('サーバーが pause を知らず 400 なら、付けずにもう一度頼む', async () => {
    const t = setup([400, 200]);
    await expect(t.api.audio('a', 'long')).resolves.toBeInstanceOf(ArrayBuffer);
    expect(t.bodies).toEqual([{ expression_id: 'a', pause: 'long' }, { expression_id: 'a' }]);
  });

  it('付けなくても 400 なら、そのまま失敗にする（くり返さない）', async () => {
    const t = setup([400, 400]);
    await expect(t.api.audio('a', 'short')).rejects.toBeInstanceOf(ApiError);
    expect(t.bodies).toHaveLength(2);
    const u = setup([400]);
    await expect(u.api.audio('a')).rejects.toBeInstanceOf(ApiError);
    expect(u.bodies).toHaveLength(1);
  });
});
