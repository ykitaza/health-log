import { claimsSwipe, swipeDirection } from '../swipe';

describe('左右のスワイプ（食事・筋トレの日の移動）', () => {
  test('横の動きが十分大きく、縦の倍以上のときだけ指を受ける（縦のスクロールと押す操作を邪魔しない）', () => {
    expect(claimsSwipe(30, 5)).toBe(true);
    expect(claimsSwipe(-30, 10)).toBe(true);
    expect(claimsSwipe(10, 0)).toBe(false); // 小さい動きは押す操作のまま
    expect(claimsSwipe(30, 20)).toBe(false); // 斜め・縦はスクロール
    expect(claimsSwipe(0, 80)).toBe(false);
  });

  test('放したとき：右へ動かすと前、左へ動かすと次。小さい・斜めの動きは何もしない', () => {
    expect(swipeDirection(80, 10)).toBe('prev');
    expect(swipeDirection(-80, -10)).toBe('next');
    expect(swipeDirection(40, 0)).toBeNull();
    expect(swipeDirection(100, 60)).toBeNull();
  });
});
