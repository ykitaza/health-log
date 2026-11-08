import type { Db } from './types';

// 同じ DB への書き込みを、1つずつ順に行う。
// expo-sqlite の withTransactionAsync は、ほかの非同期の処理の割り込みを防がない。そのため書き込みが重なると
// （欄を離れたときの保存と単位の切り替え、↑ の2回押しなど）、トランザクションが入れ子になって片方が失敗したり、
// 「探して、なければ足す」が両方とも「ない」と見て、行が2件できたりする。
const queues = new WeakMap<Db, Promise<unknown>>();

function oneAtATime<T>(db: Db, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(db) ?? Promise.resolve()).then(task, task);
  queues.set(db, next.catch(() => undefined));
  return next;
}

/**
 * リポジトリの書き込みのメソッド（names）を、同じ DB で1つずつ順に行うように包む。
 * 包んだメソッドの中から、包んだ別のメソッドを呼ばないこと（待ち合って止まる）
 */
export function serializeWrites<R extends Record<string, unknown>, K extends keyof R>(db: Db, repo: R, names: K[]): R {
  const out = { ...repo };
  for (const name of names) {
    const method = repo[name] as (...args: unknown[]) => Promise<unknown>;
    out[name] = ((...args: unknown[]) => oneAtATime(db, () => method(...args))) as R[K];
  }
  return out;
}
