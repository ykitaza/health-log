// UTF-8 のバイト列を文字列にする。3D の体（GLB）を読む GLTFLoader は TextDecoder を使うので、
// TextDecoder の無い JS エンジンに備えて、代わりを置く（components/InjuryBodyMap3D.native.tsx）

/** UTF-8 のバイト列 → 文字列。壊れた並びは U+FFFD にする */
export function decodeUtf8(bytes: Uint8Array): string {
  const out: number[] = [];
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let cp = 0xfffd;
    let n = 1;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0 && i + 1 < bytes.length) { cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); n = 2; }
    else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f); n = 3; }
    else if (b >= 0xf0 && b < 0xf5 && i + 3 < bytes.length) {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      n = 4;
    }
    i += n;
    if (cp > 0xffff) { cp -= 0x10000; out.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); } else out.push(cp);
    // String.fromCharCode に一度に渡す数を抑える
    if (out.length > 8192) { s += String.fromCharCode(...out); out.length = 0; }
  }
  return s + String.fromCharCode(...out);
}

/** TextDecoder が無ければ、UTF-8 だけを読む代わりを置く */
export function ensureTextDecoder() {
  if (typeof globalThis.TextDecoder !== 'undefined') return;
  (globalThis as { TextDecoder?: unknown }).TextDecoder = class {
    decode(input?: ArrayBuffer | ArrayBufferView) {
      if (!input) return '';
      return decodeUtf8(input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    }
  };
}
