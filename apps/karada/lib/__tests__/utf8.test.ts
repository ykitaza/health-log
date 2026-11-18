import { readFileSync } from 'fs';
import { join } from 'path';
import { decodeUtf8, ensureTextDecoder } from '../utf8';

describe('decodeUtf8（TextDecoder の無い JS エンジン向けの代わり）', () => {
  test('英数字・日本語・絵文字が、本物の TextDecoder と同じになる', () => {
    for (const text of ['abc', '三角筋 前部（右）', 'BODY MAP // SCAN ▲ 😀', '']) {
      expect(decodeUtf8(new TextEncoder().encode(text))).toBe(text);
    }
  });

  test('3D の体（GLB）の JSON の部分（日本語の部品の名前を含む）を、本物と同じに読める', () => {
    const buf = readFileSync(join(__dirname, '../../assets/models/body.glb'));
    const json = new Uint8Array(buf.buffer, buf.byteOffset + 20, buf.readUInt32LE(12));
    const text = decodeUtf8(json);
    expect(text).toBe(new TextDecoder().decode(json));
    expect(JSON.parse(text).nodes).toHaveLength(36);
  });

  test('壊れた並びは U+FFFD', () => {
    expect(decodeUtf8(new Uint8Array([0x61, 0xff, 0x62]))).toBe('a�b');
  });

  test('TextDecoder が無いときだけ代わりを置く', () => {
    const real = globalThis.TextDecoder;
    try {
      (globalThis as { TextDecoder?: unknown }).TextDecoder = undefined;
      ensureTextDecoder();
      expect(new globalThis.TextDecoder().decode(new TextEncoder().encode('腰'))).toBe('腰');
    } finally {
      globalThis.TextDecoder = real;
    }
    ensureTextDecoder();
    expect(globalThis.TextDecoder).toBe(real);
  });
});
