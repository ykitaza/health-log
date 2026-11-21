import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { colors } from '@/theme';
import { ErrorText, T } from '../Text';

// 入力の誤りの文を、TalkBack（と VoiceOver）に知らせる（#323）。部品は関数として呼び、返す要素の props を見る（touch.test.tsx と同じ）

describe('ErrorText', () => {
  let effects: (() => void)[];
  beforeEach(() => {
    effects = [];
    jest.spyOn(React, 'useEffect').mockImplementation((f) => { effects.push(f as () => void); });
  });
  afterEach(() => jest.restoreAllMocks());

  test('role は alert、色は赤。大きさと段階は渡したまま（見た目は今の T と同じ）', () => {
    const el = ErrorText({ size: 13, align: 'center', children: '品名を入れてください' });
    expect(el.type).toBe(T);
    expect(el.props.accessibilityRole).toBe('alert');
    expect(el.props.color).toBe(colors.danger);
    expect(el.props.size).toBe(13);
    expect(el.props.align).toBe('center');
    expect(el.props.children).toBe('品名を入れてください');
  });

  test('ネイティブでは、出たときに文を読み上げる（live region に頼らず、2回読ませない）', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const el = ErrorText({ variant: 'bodyS', children: '身長を入れてください' });
    expect(el.props.accessibilityLiveRegion).toBe('none');
    effects.forEach((f) => f());
    expect(announce).toHaveBeenCalledWith('身長を入れてください');
  });
});

// 7 つの画面（#322 の洗い出し）の誤りの文は、ErrorText で出す。赤の T を直に書くと、読み上げに知らせなくなる
describe('入力の誤りの文が読み上げに伝わる画面', () => {
  const screens = [
    'app/account.tsx', 'app/exercises/new.tsx', 'app/exercises/[id].tsx', 'app/exercises/manage.tsx',
    'app/meals/new.tsx', 'app/meals/goal.tsx', 'app/meals/[id].tsx',
  ];
  test.each(screens)('%s は赤の T を直に使わず、ErrorText を使う', (file) => {
    const src = readFileSync(join(__dirname, '..', '..', file), 'utf8');
    expect(src).toMatch(/<ErrorText\b/);
    expect(src.match(/<T\b[^>]*color=\{colors\.danger\}/g) ?? []).toEqual([]);
  });

  test('ErrorText の文字の大きさは、今の T のまま（size を渡すと、その大きさ）', () => {
    jest.spyOn(React, 'useEffect').mockImplementation(() => {});
    const el = ErrorText({ size: 12, children: '同じ名前の部位があります' });
    const text = T(el.props as React.ComponentProps<typeof T>);
    expect(StyleSheet.flatten(text.props.style).fontSize).toBe(12);
  });
});
