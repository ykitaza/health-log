import Constants from 'expo-constants';
import { AuthConfig } from './session';

/**
 * app.json の extra.torelog（cdk deploy の出力 AppClientId・CognitoDomain・AppApiUrl。どれも秘密ではない）。
 * 戻り先は Cognito の torelog-app に登録したものと同じ（cdk/lib/infra-stack.ts）
 */
type Extra = { clientId?: string; cognitoDomain?: string; apiUrl?: string; mcpUrl?: string };
const extra = (Constants.expoConfig?.extra?.torelog ?? {}) as Extra;

export const authConfig: AuthConfig = {
  clientId: extra.clientId ?? '',
  cognitoDomain: extra.cognitoDomain ?? '',
};
export const apiBaseUrl = extra.apiUrl ?? '';
/** チャットのコネクタに登録する MCP サーバーの URL（cdk deploy の出力 MealsMcpServerUrl。秘密ではない）。ないときは空 */
export const mcpServerUrl = extra.mcpUrl ?? '';
/**
 * 認可サーバーの URL（cdk deploy の出力 AuthzUrl。秘密ではない）。チャットの返事の「hlog に戻る」リンクの行き先（/open/…）に使う。
 * app.json の extra に置くと runtimeVersion（fingerprint）が変わり、入っている APK に配信が届かなくなるので、ここに書く
 */
export const authzUrl = 'https://urfpbaok5e.execute-api.ap-northeast-1.amazonaws.com';

/**
 * アプリの scheme（app.json の torelog。開発用の hlog (dev) は torelog-dev。app.config.ts）。
 * ログインの戻り先は scheme ごとに Cognito の torelog-app に登録してある（cdk/lib/infra-stack.ts）
 */
const scheme = typeof Constants.expoConfig?.scheme === 'string' ? Constants.expoConfig.scheme : 'torelog';
export const NATIVE_REDIRECT_URI = `${scheme}://callback`;
/** Cookie を消したあとの戻り先（lib/auth/session.ts の logoutUrl に渡す） */
export const NATIVE_LOGOUT_URI = `${scheme}://signout`;
