// テスト用：署名のない偽のアクセストークン（JWT の形）。アプリは sub だけを読む（lib/auth/session.ts の accessTokenSubject）
const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

export const fakeAccessToken = (sub: string) => `${part({ alg: 'none' })}.${part({ sub, token_use: 'access' })}.sig`;
