import {
  claimsSwipe, dragOffset, hintNudgeDx, pageDirection, releaseDirection, RUBBER_MAX_DX, rubberBand, showsSwipeHint, slideSign, SWIPE_CLAIM_DX,
  SWIPE_HINT_MAX, swipeDirection, swipeHintText,
} from '../swipe';

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

  test('次へ進めない（今日・今週）ときは、左へ引いても次へは動かさない。前へは動かす', () => {
    expect(releaseDirection(-120, 0, false)).toBeNull();
    expect(releaseDirection(-120, 0, true)).toBe('next');
    expect(releaseDirection(120, 0, false)).toBe('prev');
    expect(releaseDirection(40, 0, true)).toBeNull();
  });

  test('ゴムの抵抗：いつも指の動きより小さく、向きは指と同じ。引くほど重くなり、上限を超えない', () => {
    expect(rubberBand(0)).toBe(0);
    for (const dx of [10, 40, 100, 300, 2000]) {
      const v = rubberBand(-dx);
      expect(v).toBeLessThan(0);
      expect(Math.abs(v)).toBeLessThan(dx);
      expect(Math.abs(v)).toBeLessThan(RUBBER_MAX_DX);
    }
    expect(rubberBand(40)).toBeGreaterThan(0);
    // 引くほど増えるが、増え方は小さくなる
    expect(rubberBand(-200)).toBeLessThan(rubberBand(-100));
    expect(rubberBand(-100) - rubberBand(-200)).toBeLessThan(rubberBand(0) - rubberBand(-100));
  });

  test('指についてくる位置：受け取るまでの分を引いてなめらかに動き出す。次へ進めないときの左だけ抵抗をつける', () => {
    expect(dragOffset(SWIPE_CLAIM_DX, true)).toBe(0);
    expect(dragOffset(-SWIPE_CLAIM_DX, false)).toBe(0);
    expect(dragOffset(124, false)).toBe(100); // 前へは指と同じだけ（次へ進めなくても）
    expect(dragOffset(-124, true)).toBe(-100); // 次へ進めるなら指と同じだけ
    const rubber = dragOffset(-124, false);
    expect(rubber).toBeLessThan(0);
    expect(rubber).toBeGreaterThan(-100);
    expect(rubber).toBeCloseTo(rubberBand(-100));
    expect(dragOffset(10, true)).toBe(0); // 指を戻して元の位置をまたいでも飛ばない
  });

  test('日を変えたときの向き（日を選ぶ・今日に戻る）と、中身が出ていく向き', () => {
    expect(pageDirection('2026-11-08', '2026-11-02')).toBe('prev');
    expect(pageDirection('2026-10-31', '2026-11-08')).toBe('next');
    expect(pageDirection('2026-11-08', '2026-11-08')).toBeNull();
    expect(slideSign('next')).toBe(-1); // 次は左へ出て、右から入る（指を左へ動かす向き）
    expect(slideSign('prev')).toBe(1);
  });
});

describe('スワイプのヒント（最初の数回だけ）', () => {
  test('一度スワイプで動かしたら出さない。出した回数が上限に届いたら出さない', () => {
    expect(showsSwipeHint({ shown: 0, used: false })).toBe(true);
    expect(showsSwipeHint({ shown: SWIPE_HINT_MAX - 1, used: false })).toBe(true);
    expect(showsSwipeHint({ shown: SWIPE_HINT_MAX, used: false })).toBe(false);
    expect(showsSwipeHint({ shown: 0, used: true })).toBe(false);
    expect(SWIPE_HINT_MAX).toBe(3);
  });

  test('ずらす向き：今日（今週）で次へ進めないなら右（前の向き）、次へも進めるなら左（次の向き）。幅は 24dp', () => {
    expect(hintNudgeDx(false)).toBe(24);
    expect(hintNudgeDx(true)).toBe(-24);
  });

  test('文：食事の推移は週、ほかは日', () => {
    expect(swipeHintText('meal-day')).toBe('左右にスワイプで日を移れます');
    expect(swipeHintText('training-day')).toBe('左右にスワイプで日を移れます');
    expect(swipeHintText('meal-week')).toBe('左右にスワイプで週を移れます');
  });
});
