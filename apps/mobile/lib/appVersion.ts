/** 設定の画面のいちばん下に出す、アプリの版とアップデートの情報。値の取り出しは画面側、ここは整形だけ */
export type VersionInput = {
  dev: boolean;
  appVersion?: string | null;
  buildVersion?: string | null;
  fallbackVersion?: string | null;
  updateId?: string | null;
  createdAt?: Date | null;
  isEmbeddedLaunch?: boolean;
  channel?: string | null;
  runtimeVersion?: string | null;
};

/** 日本時間の YYYY-MM-DD HH:mm */
export function formatJst(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}

const short = (s: string, n = 8) => (s.length > n ? s.slice(0, n) : s);

/** 画面に出す行（コピー・共有にもそのまま使う） */
export function versionLines(v: VersionInput): string[] {
  const ver = v.appVersion || v.fallbackVersion || '不明';
  const lines = [`バージョン ${ver}${v.buildVersion ? `（ビルド ${v.buildVersion}）` : ''}`];
  if (v.dev) {
    lines.push('アップデート：開発版');
    return lines;
  }
  if (v.isEmbeddedLaunch || !v.updateId) lines.push('アップデート：APK に入っている版');
  else lines.push(`アップデート：${short(v.updateId)}${v.createdAt ? `（${formatJst(v.createdAt)}）` : ''}`);
  lines.push(`チャンネル：${v.channel || '不明'}　ランタイム：${v.runtimeVersion ? short(v.runtimeVersion) : '不明'}`);
  return lines;
}
