// リポジトリの層が使う、DB の最小の形。
// expo-sqlite の SQLiteDatabase はこの形を満たす。テストでは Node の node:sqlite で差し替える。

export type Bind = string | number | null;

export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: Bind[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: Bind[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: Bind[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/** 時刻と ID の作り方（テストで固定できるように外から渡す） */
export type Deps = {
  now: () => Date;
  newId: () => string;
};
