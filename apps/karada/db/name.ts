// 端末の DB のファイルの名前。app/_layout.tsx の SQLiteProvider と、見た目を起動の前に読む theme/appearance.ts の両方が使う。
// theme を読み込むと循環するので、このファイルは何も import しない
export const DB_NAME = 'torelog.db';
