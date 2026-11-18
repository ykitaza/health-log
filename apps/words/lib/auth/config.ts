import Constants from 'expo-constants';
import { AuthConfig } from './session';

/**
 * app.json の extra.kotoba。ログインは KARADA と同じ Cognito のクライアント（torelog-app）を使う（docs/words-design.md の「ログインとトークンの宛先」）。
 * clientId・cognitoDomain は KARADA の app.json と同じ値（秘密ではない）。
 * apiUrl はことばのアプリ用の API（cdk deploy の出力 WordsAppApiUrl。SSM /cognito-study/words/app/api-url）。
 * 空のときは EXPO_PUBLIC_KOTOBA_API_URL（書き出しのときに JS に入る。E2E が偽の API を指すのに使う）を読む。
 * mcpUrl はことばの MCP の URL（WordsMcpServerUrl）。コネクタの案内に出す。空なら「準備中」
 */
type Extra = { clientId?: string; cognitoDomain?: string; apiUrl?: string; mcpUrl?: string };
const extra = (Constants.expoConfig?.extra?.kotoba ?? {}) as Extra;

export const authConfig: AuthConfig = {
  clientId: extra.clientId ?? '',
  cognitoDomain: extra.cognitoDomain ?? '',
};
export const apiBaseUrl = extra.apiUrl || process.env.EXPO_PUBLIC_KOTOBA_API_URL || '';
export const mcpServerUrl = extra.mcpUrl ?? '';

/**
 * アプリの scheme（app.json の kotoba。開発用は kotoba-dev。app.config.ts）。
 * torelog:// は KARADA が使うので、ことばは自分の scheme で戻る（Cognito の torelog-app の戻り先に足す。cdk の変更）
 */
const scheme = typeof Constants.expoConfig?.scheme === 'string' ? Constants.expoConfig.scheme : 'kotoba';
export const NATIVE_REDIRECT_URI = `${scheme}://callback`;
/** Cookie を消したあとの戻り先（lib/auth/session.ts の logoutUrl に渡す） */
export const NATIVE_LOGOUT_URI = `${scheme}://signout`;
