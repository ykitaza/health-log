import { useEffect, useRef, useState } from 'react';
import { Easing } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { duration, EASE_OUT } from '@/theme/motion';

/**
 * 大きな数字を、開いたときと animKey が変わったときに 0 から数え上げる（600ms、ease-out。はね返らない）。
 * 動きを減らす設定なら数え上げず、いつも今の値を出す（期間を切り替えたあとの読み直しで値が変わっても、前の値のまま残さない）。
 * 推移の画面（components/charts.tsx の CountUpText、app/health-trend.tsx）が使う
 */
export function useCountUp(value: number, animKey?: string): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const [from, setFrom] = useState({ key: animKey, value });
  // 数え上げの途中で値が変わっても、最後は今の値で止める
  const target = useRef(value);
  useEffect(() => { target.current = value; });
  // 同じ animKey のまま値だけ変わったら（読み直しなど）、数え上げずにその値を出す
  if (from.key === animKey && from.value !== value) {
    setFrom({ key: animKey, value });
    setShown(value);
  }
  useEffect(() => {
    if (reduced) return;
    const ease = Easing.bezier(...EASE_OUT);
    // 時刻は requestAnimationFrame の時刻で測る（端末の時計の変更や、E2E で固定した時計に左右されない）
    let start: number | null = null;
    let frame = 0;
    const tick = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / duration.draw);
      setShown(target.current * ease(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    setFrom({ key: animKey, value });
    return () => cancelAnimationFrame(frame);
    // 値の変化では数え上げ直さない（上で値を出す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKey, reduced]);
  return reduced ? value : shown;
}
