import { DB_NAME } from '@/db/name';
import { parseLook, readLook } from '../appearance';
import * as web from '../appearance.web';

// 見た目（HUD・クラシック）を起動の前に同期で読むところ。expo-sqlite は差し替える（jest.mock は import より先に当たる）
const mockOpen = jest.fn();
jest.mock('expo-sqlite', () => ({ openDatabaseSync: (...args: unknown[]) => mockOpen(...args) }));

/** getFirstSync と closeSync を持つ偽の DB */
function fakeDb(row: (() => { value: string | null } | null), close: () => void = () => {}) {
  return { getFirstSync: jest.fn(row), closeSync: jest.fn(close) };
}

beforeEach(() => mockOpen.mockReset());

describe('parseLook', () => {
  test('classic だけがクラシック、ほかは HUD', () => {
    expect(parseLook('classic')).toBe('classic');
    expect(parseLook('hud')).toBe('hud');
    for (const v of [null, undefined, '', 'Classic', 'x', 1, {}]) expect(parseLook(v)).toBe('hud');
  });
});

describe('readLook（ネイティブ）', () => {
  test('SQLiteProvider と同じ DB を別の接続で開き、sync_meta の appearance.look を読んで閉じる', () => {
    const db = fakeDb(() => ({ value: 'classic' }));
    mockOpen.mockReturnValue(db);
    expect(readLook()).toBe('classic');
    expect(mockOpen).toHaveBeenCalledWith(DB_NAME, { useNewConnection: true });
    expect(db.getFirstSync).toHaveBeenCalledWith('SELECT value FROM sync_meta WHERE key = ?', ['appearance.look']);
    expect(db.closeSync).toHaveBeenCalledTimes(1);
  });

  test('覚えていない（行がない・値が null）・知らない値は HUD', () => {
    for (const row of [null, { value: null }, { value: 'x' }]) {
      mockOpen.mockReturnValue(fakeDb(() => row));
      expect(readLook()).toBe('hud');
    }
  });

  test('開けないときは HUD', () => {
    mockOpen.mockImplementation(() => { throw new Error('native module missing'); });
    expect(readLook()).toBe('hud');
  });

  test('読めない（初めての起動で表がまだない）ときは HUD で、開いた接続は閉じる', () => {
    const db = fakeDb(() => { throw new Error('no such table: sync_meta'); });
    mockOpen.mockReturnValue(db);
    expect(readLook()).toBe('hud');
    expect(db.closeSync).toHaveBeenCalledTimes(1);
  });

  test('閉じられなくても、読めた値を使う', () => {
    mockOpen.mockReturnValue(fakeDb(() => ({ value: 'classic' }), () => { throw new Error('busy'); }));
    expect(readLook()).toBe('classic');
  });
});

describe('readLook・mirrorLook（web は localStorage）', () => {
  const g = globalThis as { localStorage?: unknown };
  const original = g.localStorage;
  afterEach(() => { g.localStorage = original; });

  test('写した値を読む。覚えていない・知らない値は HUD', () => {
    const store = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    expect(web.readLook()).toBe('hud');
    web.mirrorLook('classic');
    expect(store.get('appearance.look')).toBe('classic');
    expect(web.readLook()).toBe('classic');
    store.set('appearance.look', 'x');
    expect(web.readLook()).toBe('hud');
  });

  test('localStorage が使えないときは HUD で、写すのは何もしない', () => {
    g.localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(web.readLook()).toBe('hud');
    expect(() => web.mirrorLook('classic')).not.toThrow();
  });
});

describe('theme：読んだ見た目で色と飾りを選ぶ', () => {
  const load = (look: 'hud' | 'classic') => {
    let theme!: typeof import('..');
    jest.isolateModules(() => {
      jest.doMock('../appearance', () => ({ readLook: () => look }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      theme = require('..');
    });
    return theme;
  };

  test('HUD：今の色と、飾りは全部あり・見出しは英語', () => {
    const t = load('hud');
    expect(t.look).toBe('hud');
    expect(t.colors).toBe(t.HUD_COLORS);
    expect(t.hudColors).toBe(t.HUD_METER_COLORS);
    expect(Object.values(t.deco).every(Boolean)).toBe(true);
    expect(t.lbl('LOAD', '負荷量')).toBe('LOAD');
  });

  test('クラシック：クラシックの色と、飾りは全部なし・見出しは日本語', () => {
    const t = load('classic');
    expect(t.isHud).toBe(false);
    expect(t.colors).toBe(t.CLASSIC_COLORS);
    expect(t.hudColors).toBe(t.CLASSIC_METER_COLORS);
    expect(t.hudColors.mint1).toBe('#E6E0D3');
    expect(t.colors.bg).toBe('#F5F2EA');
    expect(t.colors.text).toBe('#1B1916');
    expect(Object.values(t.deco).some(Boolean)).toBe(false);
    expect(t.lbl('LOAD', '負荷量')).toBe('負荷量');
  });

  test('意味を持つ色（回復マップ・部位の量・図・調子・回復中とケガ）は、HUD は今の値、クラシックは紙の上の色（意味は同じ）', () => {
    const hud = load('hud');
    const classic = load('classic');
    expect(hud.recoveryPalette).toBe(hud.HUD_RECOVERY_PALETTE);
    expect(hud.volumePalette).toBe(hud.HUD_VOLUME_PALETTE);
    expect(hud.figureColors).toBe(hud.HUD_FIGURE_COLORS);
    expect(hud.toneColors).toBe(hud.HUD_TONE_COLORS);
    expect(hud.loadPalette).toBe(hud.HUD_LOAD_PALETTE);
    expect(hud.PART_COLORS).toBe(hud.HUD_PART_COLORS);
    expect(classic.recoveryPalette).toBe(classic.CLASSIC_RECOVERY_PALETTE);
    expect(classic.volumePalette).toBe(classic.CLASSIC_VOLUME_PALETTE);
    expect(classic.figureColors).toBe(classic.CLASSIC_FIGURE_COLORS);
    expect(classic.toneColors).toBe(classic.CLASSIC_TONE_COLORS);
    expect(classic.loadPalette).toEqual({ orange: '#B04A0C', yellow: '#866300', injury: '#C2302A' });
    expect(classic.PART_COLORS).toBe(classic.CLASSIC_PART_COLORS);
    // 名前はそろえる
    expect(Object.keys(classic.CLASSIC_RECOVERY_PALETTE)).toEqual(expect.arrayContaining(Object.keys(hud.HUD_RECOVERY_PALETTE)));
    expect(Object.keys(classic.CLASSIC_TONE_COLORS).sort()).toEqual(Object.keys(hud.HUD_TONE_COLORS).sort());
    // 鍛えた部位の光（ホログラム）は見た目によらず HUD の色
    expect(classic.TRAINED_GLOW).toBe(hud.TRAINED_GLOW);
  });

  test('3D の体：クラシックはつや消し（MATTE_BODY）、HUD はホログラム。ホログラムの面と札の色は HUD のまま', () => {
    const hud = load('hud');
    const classic = load('classic');
    expect(hud.matteBody).toBe(false);
    expect(hud.stageColors).toBe(hud.HUD_COLORS);
    expect(classic.MATTE_BODY).toBe(true);
    expect(classic.matteBody).toBe(true);
    expect(classic.stageColors).toBe(classic.CLASSIC_COLORS);
  });

  test('クラシックの色は HUD と同じ名前をそろえて持つ', () => {
    const t = load('hud');
    expect(Object.keys(t.CLASSIC_COLORS).sort()).toEqual(Object.keys(t.HUD_COLORS).sort());
    expect(Object.keys(t.CLASSIC_METER_COLORS).sort()).toEqual(Object.keys(t.HUD_METER_COLORS).sort());
  });
});
