import { Linking } from 'react-native';

/**
 * 「AI で拾う」：チャット（Claude・ChatGPT）を、決まった頼みの文を入れて開く（KARADA の lib/chat.ts と同じ作り。docs/words-design.md の「AI で拾う」）。
 * 開くのは https の URL だけ（Android の App Links で、アプリが入っていればアプリ、なければブラウザ）。
 * URL に入れるのは、アプリが決めた文だけ。表現の中身・メモ・題は入れない。場所の名前は、初期の5つを選んでいるときだけ入れる
 * （本人が足した名前は、本人が書いた文字なので入れない）。アプリへ戻るリンクは v1 では付けない
 */
export type ChatApp = 'chatgpt' | 'claude';

export const CHAT_APP_NAMES: Record<ChatApp, string> = { chatgpt: 'ChatGPT', claude: 'Claude' };
const BASE: Record<ChatApp, string> = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new' };

/** URL の長さの上限 */
export const MAX_URL_LENGTH = 2000;

/** 初期の場所の名前（seed の5つ）。これ以外の名前は文に入れない */
export const SEED_SOURCE_NAMES = ['Audible', 'Kindle', '紙の本', '会話', '動画'] as const;

export type ChatPrompt = {
  kind: 'capture';
  /** 選んでいる場所が初期の5つのどれかなら、その名前 */
  seedSource?: string | null;
  /** 書き留めるの「使いたい」をオンにして開いた */
  wantToUse?: boolean;
};

/** 頼みの文 */
export function promptText(p: ChatPrompt): string {
  const source = p.seedSource && (SEED_SOURCE_NAMES as readonly string[]).includes(p.seedSource) ? p.seedSource : null;
  // URL の上限（2,000文字。日本語は1文字が9文字になる）に入るよう、要点だけにする。聞き方の決まりはサーバーの説明に書いてある
  return 'ことば（表現を集める MCP コネクタ）で表現を拾ってください。'
    + `${source ? `${source}で出会ったものです。` : ''}${p.wantToUse ? '手札に入れたいものです（want_to_use）。' : ''}`
    + 'これから声・写真・ハイライトで渡します。表現・場所（list_facets の名前）・題・位置・場面を読み取り、capture_expression で保存（複数なら capture_expressions）。'
    + '分からなければ1回だけまとめて聞き、推測で埋めないで。新しい場所だけ確かめて。保存したら短く見せて。';
}

/** 開く URL。prompt がなければ、アプリを開くだけ */
export function chatUrl(app: ChatApp, prompt?: ChatPrompt): string {
  if (!prompt) return BASE[app];
  const url = `${BASE[app]}?q=${encodeURIComponent(promptText(prompt))}`;
  // 決まった文だけなので上限に届かないが、届いたら文を入れずに開く
  return url.length <= MAX_URL_LENGTH ? url : BASE[app];
}

export const openFailedMessage = (app: ChatApp) => `${CHAT_APP_NAMES[app]} を開けませんでした。ブラウザで開けるか確かめてください。`;

/** 開けたら true。開けなかったら false（呼ぶ側で案内を出す） */
export async function openChat(app: ChatApp, prompt?: ChatPrompt, open: (url: string) => Promise<unknown> = (u) => Linking.openURL(u)): Promise<boolean> {
  try {
    await open(chatUrl(app, prompt));
    return true;
  } catch {
    return false;
  }
}

/** 選ぶシートの並び。最後に選んだほうを上に（初めは Claude が上） */
export function orderedApps(last: ChatApp | null): ChatApp[] {
  return last === 'chatgpt' ? ['chatgpt', 'claude'] : ['claude', 'chatgpt'];
}

export const isChatApp = (v: unknown): v is ChatApp => v === 'chatgpt' || v === 'claude';

/** 言いたいことから探す（探すの上の札）。Claude が、拾った言葉から選ぶ。言いたいことは本人がチャットで書く（URL に入れない） */
export function intentPromptText(): string {
  return 'ことば（日本語の表現を集める MCP コネクタ）で、言いたいことに合う表現を、私が拾ったものから探してください。\n'
    + 'これから言いたいことを伝えます。list_facets・grep_words・get_words で探し、合うものを3〜5個、なぜ合うかと言い方の例を添えて見せてください。';
}
export const intentChatUrl = (app: ChatApp) => `${BASE[app]}?q=${encodeURIComponent(intentPromptText())}`;
