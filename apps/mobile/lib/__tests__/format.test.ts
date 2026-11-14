import { formatSigned, isFlat } from '../format';

describe('formatSigned', () => {
  it('小数1桁で 0 になる値は ±0（-0 や -0.04 も）', () => {
    expect(formatSigned(0)).toBe('±0');
    expect(formatSigned(-0)).toBe('±0');
    expect(formatSigned(-0.04)).toBe('±0');
    expect(formatSigned(0.04)).toBe('±0');
  });

  it('0.05 は正負とも 0.1 に丸まるので符号がつく', () => {
    expect(formatSigned(0.05)).toBe('+0.1');
    expect(formatSigned(-0.05)).toBe('−0.1');
  });

  it('ふつうの値は符号つきの小数1桁（マイナスは全角の「−」）', () => {
    expect(formatSigned(1.23)).toBe('+1.2');
    expect(formatSigned(-1.23)).toBe('−1.2');
  });
});

describe('isFlat', () => {
  it('表示が ±0 になる値だけ true', () => {
    expect(isFlat(-0)).toBe(true);
    expect(isFlat(-0.04)).toBe(true);
    expect(isFlat(0.05)).toBe(false);
    expect(isFlat(-1)).toBe(false);
  });
});
