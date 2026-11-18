import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Easing } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { countAt, Entrance, INITIAL_ENTRANCE, nextEntrance } from '@/lib/entrance';
import { duration, EASE_OUT } from '@/theme/motion';

/**
 * ホームの動きを、いつ動かすか（lib/entrance.ts）。sig は値を比べる文字（読み込む前は null）。
 * 画面が見えるようになるたびと、見えているあいだに値が変わったときに、token が 1 増える（動かす合図）。
 * prev は動きの始まり（null なら 0 から）。focused は今この画面が見えているか
 */
export function useEntrance<T>(value: T | null, sig: string | null): { token: number; prev: T | null; focused: boolean } {
  const focused = useIsFocused();
  const [st, setSt] = useState<Entrance<T>>(() => nextEntrance(INITIAL_ENTRANCE as Entrance<T>, focused, sig, value));
  let cur = st;
  if (st.focused !== focused || st.sig !== sig) {
    cur = nextEntrance(st, focused, sig, value);
    setSt(cur);
  }
  return { token: cur.token, prev: cur.prev, focused };
}

/**
 * ホームの大きな数字の数え上げ（600ms、ease-out。はね返らない）。読み込む前（null）は null を返し、動かさない。
 * ホームが見えるたびに 0 から数え、見えているあいだに値が変わったら、いま見せている値から数える。同じ値の読み直しでは数えない。
 * 動きを減らす設定なら、すぐに最後の値
 */
export function useCountTo(value: number | null): number | null {
  const reduced = useReducedMotion();
  const { token, prev, focused } = useEntrance(value, value == null ? null : String(value));
  const [now, setNow] = useState<number | null>(reduced || value == null ? value : 0);
  const nowRef = useRef(now);
  // 合図が来たとき、0 から数えるなら描く前に 0 に戻す（最後の値が一瞬見えないように）。
  // nowRef は書かない：0 から数えるときは下の効果が nowRef を読まず（from = 0）、最初のコマで書き換わる
  const [seen, setSeen] = useState(token);
  if (seen !== token) {
    setSeen(token);
    if (prev == null && !reduced) setNow(0);
  }
  useEffect(() => {
    if (reduced || value == null) {
      nowRef.current = value;
      setNow(value);
      return;
    }
    // 見えているあいだに値が変わったら、いま見せている値から数え直す
    const from = prev == null ? 0 : nowRef.current ?? prev;
    const ease = Easing.bezier(...EASE_OUT);
    // 時刻は requestAnimationFrame の時刻で測る（components/charts.tsx の useCountUp と同じ）
    let start: number | null = null;
    let frame = 0;
    const tick = (t: number) => {
      start ??= t;
      const p = Math.min(1, (t - start) / duration.draw);
      const v = countAt(from, value, ease(p));
      nowRef.current = v;
      setNow(v);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // 動かすのは合図（token）が来たときだけ。value と prev は合図と一緒に変わる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reduced, value == null]);
  // 動かさないとき（読み込む前・動きを減らす設定・見えていないあいだ）は、描き直しを待たずに今の値
  return reduced || !focused || value == null ? value : now;
}
