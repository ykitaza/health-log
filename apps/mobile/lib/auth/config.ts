import Constants from 'expo-constants';
import { AuthConfig } from './session';

/**
 * app.json の extra.torelog（cdk deploy の出力 AppClientId・CognitoDomain・AppApiUrl。どれも秘密ではない）。
 * 戻り先は Cognito の torelog-app に登録したものと同じ（cdk/lib/infra-stack.ts）
 */
type Extra = { clientId?: string; cognitoDomain?: string; apiUrl?: string };
const extra = (Constants.expoConfig?.extra?.torelog ?? {}) as Extra;

export const authConfig: AuthConfig = {
  clientId: extra.clientId ?? '',
  cognitoDomain: extra.cognitoDomain ?? '',
};
export const apiBaseUrl = extra.apiUrl ?? '';

export const NATIVE_REDIRECT_URI = 'torelog://callback';
