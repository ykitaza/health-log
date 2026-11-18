import { formatJst, versionLines } from '../appVersion';

test('日本時間で出す', () => {
  expect(formatJst(new Date('2026-11-08T16:05:00Z'))).toBe('2026-11-09 01:05');
});

test('アップデートで動いているとき', () => {
  expect(versionLines({
    dev: false, appVersion: '1.0.0', buildVersion: '7', updateId: '0a1b2c3d-4e5f-6789-abcd-ef0123456789',
    createdAt: new Date('2026-11-09T03:00:00Z'), isEmbeddedLaunch: false, channel: 'preview', runtimeVersion: 'abcdef0123456789abcd',
  })).toEqual([
    'バージョン 1.0.0（ビルド 7）',
    'アップデート：0a1b2c3d（2026-11-09 12:00）',
    'チャンネル：preview　ランタイム：abcdef01',
  ]);
});

test('APK に入っている版', () => {
  expect(versionLines({ dev: false, appVersion: '1.0.0', buildVersion: '7', updateId: 'x', isEmbeddedLaunch: true, channel: 'preview', runtimeVersion: 'r' })[1])
    .toBe('アップデート：APK に入っている版');
});

test('開発版：値がなくても落ちず、app.json の version に戻る', () => {
  expect(versionLines({ dev: true, appVersion: null, fallbackVersion: '1.0.0' })).toEqual(['バージョン 1.0.0', 'アップデート：開発版']);
  expect(versionLines({ dev: true })).toEqual(['バージョン 不明', 'アップデート：開発版']);
});
