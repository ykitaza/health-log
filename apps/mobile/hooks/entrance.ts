import { useEffect, useRef, useState } from 'react';
import { Easing } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { countAt, entranceOf, Shown } from '@/lib/entrance';
import { duration, EASE_OUT } from '@/theme/motion';

/** 前に見せた値（名前ごと。アプリを開いているあいだだけ覚える） */
const shown = new Map<string, Shown<unknown>>();

/**
 * ホームに来たときの動きを、いつ動かすか（lib/entrance.ts）。key は見せる場所の名前、sig は値を比べる文字（読み込む前は null）。
 * fresh なら動かす。prev は前に見せた値（動きの始まり。初めてなら null）。見せた値は描いたあとに覚える
 */
export function useEntrance<T>(key: string, value: T | null, sig: string | null): { fresh: boolean; prev: T | null } {
  const read = () => ({ sig, ...entranceOf(shown.get(key) as Shown<T> | undefined, sig) });
  const [st, setSt] = useState(read);
  let cur = st;
  if (st.sig !== sig) {
    cur = read();
    setSt(cur);
  }
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; });
  useEffect(() => {
    if (sig != null) shown.set(key, { sig, value: valueRef.current });
  }, [key, sig]);
  return { fresh: cur.fresh, prev: cur.prev };
}

/**
 * ホームの大きな数字の数え上げ（600ms、ease-out。はね返らない）。読み込む前（null）は null を返し、動かさない。
 * アプリを開いて初めて見せるときは 0 から、値が変わったら前の値から数える。タブの行き来や同じ値の読み直しでは数えない。
 * 動きを減らす設定なら、すぐに最後の値
 */
export function useCountTo(key: string, value: number | null): number | null {
  const reduced = useReducedMotion();
  const { fresh, prev } = useEntrance(key, value, value == null ? null : String(value));
  const animate = fresh && !reduced && value != null;
  const [now, setNow] = useState<number | null>(animate ? prev ?? 0 : value);
  const nowRef = useRef(now);
  useEffect(() => {
    if (!animate || value == null) {
      nowRef.current = value;
      setNow(value);
      return;
    }
    // 数え上げの途中で値が変わったら、いま見せている値から数え直す
    const from = nowRef.current ?? prev ?? 0;
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
    // prev は value と一緒に変わる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, value]);
  // 動かさないときは、描き直しを待たずに今の値
  return animate ? now : value;
}
