import {
  accountTitle, choosePhoto, DISPLAY_NAME_MAX, HOME_ACCOUNT_LABEL, loginStatusText, normalizeDisplayName, PhotoDeps, photoOrNull, removePhoto, shrinkSize,
} from '../profile';

describe('表示名', () => {
  test('前後の空白を除く。空・空白だけなら null（表示名なし）', () => {
    expect(normalizeDisplayName('  たろう ')).toBe('たろう');
    expect(normalizeDisplayName('')).toBeNull();
    expect(normalizeDisplayName('　 ')).toBeNull();
  });

  test('上限の文字数で切る（絵文字などのサロゲートペアを途中で割らない）', () => {
    expect(normalizeDisplayName('あ'.repeat(DISPLAY_NAME_MAX + 5))).toBe('あ'.repeat(DISPLAY_NAME_MAX));
    expect(normalizeDisplayName('😀'.repeat(DISPLAY_NAME_MAX + 1))).toBe('😀'.repeat(DISPLAY_NAME_MAX));
  });

  test('見出しは表示名。なければ「アカウント」', () => {
    expect(accountTitle('たろう')).toBe('たろう');
    expect(accountTitle(null)).toBe('アカウント');
  });
});

test('ログインの状態の1行と、ホームの写真の読み上げ', () => {
  expect(loginStatusText(true)).toBe('ログインしています');
  expect(loginStatusText(false)).toBe('ログインしていません');
  expect(HOME_ACCOUNT_LABEL).toBe('アカウント。押すとアカウントの画面');
});

test('写真がないとき（null・空）はアプリのアイコンを出す', () => {
  expect(photoOrNull('file:///data/profile/photo-1.jpg')).toBe('file:///data/profile/photo-1.jpg');
  expect(photoOrNull(null)).toBeNull();
  expect(photoOrNull(undefined)).toBeNull();
  expect(photoOrNull(' ')).toBeNull();
});

test('写真は長辺を 512px に縮める。小さければ縮めない', () => {
  expect(shrinkSize(1080, 1080)).toEqual({ width: 512 });
  expect(shrinkSize(2000, 3000)).toEqual({ height: 512 });
  expect(shrinkSize(4000, 3000)).toEqual({ width: 512 });
  expect(shrinkSize(512, 512)).toBeNull();
  expect(shrinkSize(300, 200)).toBeNull();
});

describe('写真を選ぶ・外す', () => {
  const setup = (picked: { uri: string; width: number; height: number } | null) => {
    const calls: string[] = [];
    const deps: PhotoDeps = {
      pick: async () => { calls.push('pick'); return picked; },
      shrink: async (uri, size) => { calls.push(`shrink ${uri} ${JSON.stringify(size)}`); return 'cache://small.jpg'; },
      save: async (uri) => { calls.push(`save ${uri}`); return 'doc://profile/photo-2.jpg'; },
      remove: async (uri) => { calls.push(`remove ${uri}`); },
    };
    const put = jest.fn(async (uri: string | null) => { calls.push(`put ${uri}`); });
    return { deps, put, calls };
  };

  test('選んだら縮めてコピーし、覚えてから前の写真を消す', async () => {
    const { deps, put, calls } = setup({ uri: 'cache://picked.jpg', width: 1080, height: 1080 });
    expect(await choosePhoto(deps, 'doc://profile/photo-1.jpg', put)).toBe(true);
    expect(calls).toEqual([
      'pick', 'shrink cache://picked.jpg {"width":512}', 'save cache://small.jpg', 'put doc://profile/photo-2.jpg', 'remove doc://profile/photo-1.jpg',
    ]);
  });

  test('やめたら何もしない（今の写真はそのまま）', async () => {
    const { deps, put, calls } = setup(null);
    expect(await choosePhoto(deps, 'doc://profile/photo-1.jpg', put)).toBe(false);
    expect(calls).toEqual(['pick']);
  });

  test('前の写真がなければ消さない。前の写真を消せなくても、新しい写真は使う', async () => {
    const { deps, put, calls } = setup({ uri: 'cache://picked.jpg', width: 300, height: 300 });
    expect(await choosePhoto(deps, null, put)).toBe(true);
    expect(calls.filter((c) => c.startsWith('remove'))).toEqual([]);
    expect(calls[1]).toBe('shrink cache://picked.jpg null');

    const failing = setup({ uri: 'cache://picked.jpg', width: 300, height: 300 });
    failing.deps.remove = async () => { throw new Error('消せない'); };
    await expect(choosePhoto(failing.deps, 'doc://profile/photo-1.jpg', failing.put)).resolves.toBe(true);
    expect(failing.put).toHaveBeenCalledWith('doc://profile/photo-2.jpg');
  });

  test('覚えられなかったら、コピーした写真を消してエラーにする（前の写真は残す）', async () => {
    const { deps, calls } = setup({ uri: 'cache://picked.jpg', width: 300, height: 300 });
    const put = async () => { throw new Error('DB'); };
    await expect(choosePhoto(deps, 'doc://profile/photo-1.jpg', put)).rejects.toThrow('DB');
    expect(calls.filter((c) => c.startsWith('remove'))).toEqual(['remove doc://profile/photo-2.jpg']);
  });

  test('外すときは、値を消してからファイルを消す。消せなくても値は消したまま', async () => {
    const { deps, put, calls } = setup(null);
    await removePhoto(deps, 'doc://profile/photo-1.jpg', put);
    expect(calls).toEqual(['put null', 'remove doc://profile/photo-1.jpg']);

    deps.remove = async () => { throw new Error('消せない'); };
    await expect(removePhoto(deps, 'doc://profile/photo-1.jpg', put)).resolves.toBeUndefined();
  });
});
