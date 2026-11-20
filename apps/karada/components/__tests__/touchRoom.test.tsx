import { readFileSync } from 'fs';
import { join } from 'path';
import { MIN_TOUCH, touchRow, touchSquare } from '@/lib/touch';
import { INPUT_ROOM, ROOM_INPUT_HEIGHT } from '../Input';

// 見た目は今のまま、押せる範囲だけ 48 にしたもの（#323）。並びの大きさ（押せる範囲 ＋ 外の負の margin）が今と同じかも見る
const src = (file: string) => readFileSync(join(__dirname, '..', '..', file), 'utf8');

describe('押せる範囲を 48 に広げたもの', () => {
  test('touchSquare（44 のボタン）：押せる範囲は 48×48、並びは 44×44 のまま', () => {
    const s = touchSquare(44);
    expect(s.width).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(s.height).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(s.width + 2 * s.margin).toBe(44);
    expect(s.height + 2 * s.margin).toBe(44);
  });

  test('touchRow（高さ 44 の行）：押せる範囲は縦 48、並びは 44 のまま', () => {
    const s = touchRow(44);
    expect(s.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(s.minHeight + 2 * s.marginVertical).toBe(44);
  });

  test('レポートのメニュー（…）と「このレポートを消す」は、44 を 48 に広げたもの', () => {
    const report = src('components/report/ReportDetail.tsx');
    expect(report).toMatch(/touchSquare\(MENU_SLOT\)/);
    expect(report).toMatch(/const MENU_SLOT = 44;/);
    expect(report).toMatch(/touchRow\(44\)/);
    expect(report).toMatch(/style=\{REPORT_MENU_BUTTON\}/);
    expect(report).toMatch(/style=\{REPORT_MENU_ITEM\}/);
  });

  test('食事の入力欄（見た目 44）：外側を広げて押せる範囲は縦 48、並びは 44 のまま。3 つの画面の 44 の欄は RoomInput', () => {
    expect(ROOM_INPUT_HEIGHT + 2 * INPUT_ROOM.paddingVertical).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(ROOM_INPUT_HEIGHT + 2 * INPUT_ROOM.paddingVertical + 2 * INPUT_ROOM.marginVertical).toBe(ROOM_INPUT_HEIGHT);
    for (const file of ['app/meals/new.tsx', 'app/meals/[id].tsx', 'app/meals/goal.tsx']) {
      const s = src(file);
      expect(s).toMatch(/height: 44/);
      expect(s).toMatch(/<RoomInput\b/);
    }
  });
});
