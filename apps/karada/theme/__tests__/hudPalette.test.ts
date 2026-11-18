import { colors, HUD_COLORS, HUD_METER_COLORS, hudColors, look, recoveryPalette, TRAINED_GLOW } from '..';

// HUD（初期値の見た目）の色が、見た目を切り替える仕組みを入れる前（#255 の時点）と 1 文字も変わらないこと。
// 値は main の theme/index.ts からそのまま写した。HUD の色を変えるときは、ここも直す
const BEFORE_COLORS = {
  bg: '#0E1013',
  card: '#181B20',
  input: '#22262D',
  line: '#2C313A',
  outline: '#6E7580',
  text: '#F3F5F7',
  sub: '#9AA1AD',
  accent: '#5BE49B',
  onAccent: '#08130D',
  accentDark: '#173A28',
  onAccentDark: '#A6F2C8',
  accentMuted: '#3F8F63',
  inverseAccent: '#1B6B43',
  danger: '#F4666B',
  dangerDark: '#3A1719',
  onDangerDark: '#FFB3B5',
  star: '#F5A524',
  disabled: '#6B6E72',
  disabledContainer: '#32353A',
  scrim: 'rgba(0,0,0,0.6)',
};
const BEFORE_HUD_COLORS = {
  mint1: '#327D55',
  mint2: '#44A872',
  mint3: '#5BE49B',
  empty: '#22262D',
  ring: '#2A2F37',
  bracket: '#3F8F63',
};

describe('HUD の色は前と同じ', () => {
  test('初期値の見た目は HUD', () => {
    expect(look).toBe('hud');
  });
  test('colors', () => {
    expect(colors).toStrictEqual(BEFORE_COLORS);
    expect(HUD_COLORS).toStrictEqual(BEFORE_COLORS);
  });
  test('hudColors', () => {
    expect(hudColors).toStrictEqual(BEFORE_HUD_COLORS);
    expect(HUD_METER_COLORS).toStrictEqual(BEFORE_HUD_COLORS);
  });
  test('回復マップと鍛えた部位の光', () => {
    expect(recoveryPalette).toStrictEqual({ rest: '#5BE49B', restFill: '#3F8F63', idle: '#6E7580', idleFill: '#4A515D' });
    expect(TRAINED_GLOW).toBe('#A6F2C8');
  });
});
