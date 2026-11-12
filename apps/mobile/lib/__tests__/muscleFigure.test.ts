import { muscleFigureFor } from '../muscleFigure';
import { SEED_BODY_PARTS } from '@/db/seed';

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
