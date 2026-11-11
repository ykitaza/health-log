import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useRef, useState } from 'react';
import { syncStore } from '@/db/repositories/sync';
import { GROWTH_SHAPE_KEY, parseShapeKind } from '@/lib/shapes/labels';
import type { ShapeKind } from '@/lib/shapes/types';

/**
 * 選んだ「記録で育つ形」（端末だけに置く。同期しない）。画面が前に出るたびに読み直す（成長を見る画面で変えて、ホームに戻ったとき）。
 * shape は読み終えるまで null（最初の形を出してから選んだ形に変わって見えないように）。読めなければ最初の形
 */
export function useGrowthShape(): { shape: ShapeKind | null; setShape: (kind: ShapeKind) => void } {
  const db = useSQLiteContext();
  const store = useMemo(() => syncStore(db), [db]);
  const [shape, setShapeState] = useState<ShapeKind | null>(null);
  // 読み直しが重なったときは、最後に始めたものの結果だけを使う。変えたあとに、変える前の読み込みの結果で上書きしない
  const latest = useRef(0);
  useFocusEffect(useCallback(() => {
    const n = ++latest.current;
    void store.getMeta(GROWTH_SHAPE_KEY).catch(() => null).then((v) => {
      if (n === latest.current) setShapeState(parseShapeKind(v));
    });
  }, [store]));
  const setShape = useCallback((kind: ShapeKind) => {
    latest.current += 1;
    setShapeState(kind);
    void store.setMeta(GROWTH_SHAPE_KEY, kind).catch(() => {});
  }, [store]);
  return { shape, setShape };
}
