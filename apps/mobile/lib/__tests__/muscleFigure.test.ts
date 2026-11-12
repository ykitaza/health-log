import { SITE_CODES } from '../injuries';
import { FIGURE_PIECES, FIGURE_TARGETS, markPoint, muscleFigureFor, pickTarget, sideAt, subpaths, targetsNear } from '../muscleFigure';
import { SEED_BODY_PARTS } from '@/db/seed';

describe('ケガの部位：図の左右と、押して選ぶ', () => {
  test('前の図は画面の左が本人の右（R FRONT L）、後ろの図は画面の左が本人の左（L BACK R）', () => {
    expect([sideAt('front', 30), sideAt('front', 70)]).toEqual(['right', 'left']);
    expect([sideAt('back', 30), sideAt('back', 70)]).toEqual(['left', 'right']);
  });

  test('左右のある筋肉は左右の片に分かれ、片ごとに1つの部分パス（腹筋・腰の筋肉は左右なしで1片）', () => {
    for (const view of ['front', 'back'] as const) {
      for (const p of FIGURE_PIECES[view]) {
        if (p.side == null) expect(['abs', 'lower_back']).toContain(p.site);
        if (p.side != null) expect(sideAt(view, (p.box.x0 + p.box.x1) / 2)).toBe(p.side);
      }
    }
    const pecs = FIGURE_PIECES.front.filter((p) => p.site === 'chest');
    expect(pecs.map((p) => [p.side, subpaths(p.d).length])).toEqual([['right', 1], ['left', 1]]);
    // 後ろの僧帽筋は1つのパス（Figma でも1つ）なので、まん中で切った左右の片
    expect(FIGURE_PIECES.back.filter((p) => p.site === 'trapezius').map((p) => [p.side, p.clip])).toEqual([['left', 'left'], ['right', 'right']]);
  });

  test('押した点の部位：画面の左の胸は右胸、後ろの左の肘は左ひじ、体の外は選ばない', () => {
    expect(pickTarget('front', { x: 42, y: 45 })).toMatchObject({ site: 'chest', side: 'right' });
    expect(pickTarget('front', { x: 58, y: 45 })).toMatchObject({ site: 'chest', side: 'left' });
    expect(pickTarget('front', { x: 26, y: 45 })).toMatchObject({ site: 'shoulder_front', side: 'right' });
    expect(pickTarget('front', { x: 50, y: 70 })).toMatchObject({ site: 'abs', side: null });
    expect(pickTarget('front', { x: 41, y: 144 })).toMatchObject({ site: 'knee', side: 'right' });
    expect(pickTarget('back', { x: 27, y: 73 })).toMatchObject({ site: 'elbow', side: 'left' });
    expect(pickTarget('back', { x: 58, y: 105 })).toMatchObject({ site: 'glutes', side: 'right' });
    expect(pickTarget('front', { x: 5, y: 190 })).toBeNull();
  });

  test('近くの部位は近い順で重ならない。どの部位コードも、どちらかの図で選べる', () => {
    const near = targetsNear('front', { x: 33, y: 38 });
    expect(near.length).toBeGreaterThan(1);
    expect(new Set(near.map((t) => `${t.site}/${t.side}`)).size).toBe(near.length);
    const all = new Set([...FIGURE_TARGETS.front, ...FIGURE_TARGETS.back].map((t) => t.site));
    expect([...all].sort()).toEqual([...SITE_CODES].sort());
  });

  test('印の位置：その部位の左右の片のまん中。前腕は前、僧帽筋は後ろ。知らないコードは null', () => {
    expect(markPoint('shoulder_front', 'right')).toMatchObject({ view: 'front' });
    expect(markPoint('shoulder_front', 'right')!.point.x).toBeLessThan(50);
    expect(markPoint('shoulder_front', 'left')!.point.x).toBeGreaterThan(50);
    expect(markPoint('waist', null)).toEqual({ view: 'back', point: { x: 50, y: 93 } });
    expect(markPoint('forearm', 'left')!.view).toBe('front');
    expect(markPoint('trapezius', 'left')!.view).toBe('back');
    expect(markPoint('knee', null)).not.toBeNull(); // 左右が分からないときも置ける
    expect(markPoint('toe', 'left')).toBeNull();
  });
});

describe('muscleFigureFor（最近の流れの筋肉の図：部位 → 向きと塗る筋肉）', () => {
  test('背中は後ろ姿で僧帽筋・広背筋・脊柱起立筋。胸・脚・肩は前から', () => {
    expect(muscleFigureFor('背中')).toEqual({ view: 'back', muscles: ['trapezius', 'lats', 'erectors'] });
    expect(muscleFigureFor('胸')).toEqual({ view: 'front', muscles: ['pecs'] });
    expect(muscleFigureFor('脚')).toEqual({ view: 'front', muscles: ['quads', 'shins'] });
    expect(muscleFigureFor('肩')).toEqual({ view: 'front', muscles: ['deltoid'] });
  });

  test('腕：上腕二頭筋・上腕三頭筋は前から二頭筋と前腕（Figma の腕（前））。腹筋は前から腹筋と腹斜筋', () => {
    expect(muscleFigureFor('上腕二頭筋')).toEqual({ view: 'front', muscles: ['biceps', 'forearm'] });
    expect(muscleFigureFor('上腕三頭筋')).toEqual({ view: 'front', muscles: ['biceps', 'forearm'] });
    expect(muscleFigureFor('腹筋')).toEqual({ view: 'front', muscles: ['abs', 'obliques'] });
  });

  test('初期の部位はどれも、どこかの筋肉を塗る', () => {
    for (const p of SEED_BODY_PARTS) expect(muscleFigureFor(p.name).muscles.length).toBeGreaterThan(0);
  });

  test('前後の空白は無視する。知らない部位は前から見た図で、どこも塗らない', () => {
    expect(muscleFigureFor(' 背中 ').view).toBe('back');
    expect(muscleFigureFor('下半身')).toEqual({ view: 'front', muscles: [] });
    expect(muscleFigureFor('')).toEqual({ view: 'front', muscles: [] });
  });
});
