import { useFocusEffect } from 'expo-router';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { backToToday } from '@/lib/today';

/**
 * 日付を動かせる画面（ホーム・食事・体組成）で、今日でない日を見ているときは、Android の戻るでまず今日に戻す。
 * 今日を見ているときは何もしない（いつもの戻る）。画面が前に出ている間だけ受ける（ほかの画面の戻るを横取りしない）
 */
export function useBackToToday(isToday: boolean, goToday: () => void) {
  const goRef = useRef(goToday);
  useLayoutEffect(() => { goRef.current = goToday; });
  useFocusEffect(useCallback(() => {
    if (isToday) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => backToToday(isToday, () => goRef.current()));
    return () => sub.remove();
  }, [isToday]));
}
