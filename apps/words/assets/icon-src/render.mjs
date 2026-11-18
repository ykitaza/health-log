// アプリのアイコンを描き出す（node assets/icon-src/render.mjs）。紙の地に、墨の「言」と藍の点（Shippori Mincho）。
// 文字は @expo-google-fonts/shippori-mincho（OFL）。Playwright の Chromium で PNG にする
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const font = readFileSync(`${root}node_modules/@expo-google-fonts/shippori-mincho/400Regular/ShipporiMincho_400Regular.ttf`).toString('base64');
const out = (name) => `${root}assets/images/${name}`;

const PAPER = '#F6F3EC';
const INK = '#24221F';
const INDIGO = '#2B4570';

/** bg：地の色（null なら透明）。color：文字の色。scale：文字の大きさ（1024 に対して） */
const page = ({ size, bg, color, scale, dot = true }) => `<!doctype html><html><head><style>
@font-face { font-family: M; src: url(data:font/ttf;base64,${font}); }
html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${bg ?? 'transparent'}; }
.c { width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; position: relative; }
.t { font-family: M; font-size: ${size * scale}px; color: ${color}; line-height: 1; transform: translateY(-2%); }
.d { position: absolute; width: ${size * scale * 0.09}px; height: ${size * scale * 0.09}px; border-radius: 50%; background: ${dot ? INDIGO : color};
  right: ${size * (0.5 - scale * 0.56)}px; bottom: ${size * (0.5 - scale * 0.52)}px; }
</style></head><body><div class="c"><span class="t">言</span>${dot !== null ? '<span class="d"></span>' : ''}</div></body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const shot = async (name, opts) => {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: opts.size, height: opts.size });
  await p.setContent(page(opts));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: out(name), omitBackground: !opts.bg });
  await p.close();
};
await shot('icon.png', { size: 1024, bg: PAPER, color: INK, scale: 0.56 });
await shot('android-icon-foreground.png', { size: 1024, bg: null, color: INK, scale: 0.38 });
await shot('android-icon-monochrome.png', { size: 1024, bg: null, color: '#000000', scale: 0.38, dot: false });
await shot('splash-icon.png', { size: 1024, bg: null, color: INK, scale: 0.4 });
await shot('notification-icon.png', { size: 96, bg: null, color: '#FFFFFF', scale: 0.8, dot: false });
await shot('favicon.png', { size: 48, bg: PAPER, color: INK, scale: 0.8 });
await browser.close();
