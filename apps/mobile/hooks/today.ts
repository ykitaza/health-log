import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { DateKey, todayKey } from '@/lib/date';
import { watchToday } from '@/lib/today';

/**
 * 今日の日付。日付が変わったら描き直す（0時、前面に戻したとき、画面が前に出たとき）。
 * onChange には、変わった後と前の今日を渡す（選んでいた日が前の今日なら、新しい今日へ移すなど）
 */
export function useToday(onChange?: (next: DateKey, prev: DateKey) => void): DateKey {
  const [today, setToday] = useState(() => todayKey());
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => { onChangeRef.current = onChange; });
  const check = useRef(() => {});
  useEffect(() => {
    const w = watchToday((next, prev) => {
      setToday(next);
      onChangeRef.current?.(next, prev);
    });
    check.current = w.check;
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') w.check(); });
    return () => { sub.remove(); w.stop(); check.current = () => {}; };
  }, []);
  useFocusEffect(useCallback(() => { check.current(); }, []));
  return today;
}
