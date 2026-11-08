import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { Input, INPUT_BASE } from '../Input';
import { TAB_BAR_HEIGHT, tabBarStyle } from '../tabBar';

// Android の実機でだけ起きる表示の崩れの確かめ。web（E2E）では再現しないので、スタイルの値で確かめる

describe('入力欄（Android で文字が上下に切れない）', () => {
  test('既定のスタイルに、フォントの余白なし・縦の中央揃え・上下の余白なしが入っている', () => {
    expect(INPUT_BASE).toEqual({ includeFontPadding: false, textAlignVertical: 'center', paddingVertical: 0 });
  });

  test('Input は既定のスタイルの上に、画面ごとのスタイルを重ねる', () => {
    const el = Input({ style: { height: 48, fontSize: 18 } });
    const style = StyleSheet.flatten(el.props.style);
    expect(style).toMatchObject({ includeFontPadding: false, textAlignVertical: 'center', paddingVertical: 0, height: 48, fontSize: 18 });
  });

  test('画面で指定した上下の余白は、既定より優先される', () => {
    const el = Input({ style: { paddingVertical: 6 } });
    expect(StyleSheet.flatten(el.props.style).paddingVertical).toBe(6);
  });

  test('画面は react-native の TextInput を直接使わず、Input を通す', () => {
    const root = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === '__tests__' || name === 'node_modules') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(join(root, 'app'));
    walk(join(root, 'components'));
    const direct = files.filter((p) => !p.endsWith(join('components', 'Input.tsx')) && /\bTextInput\b/.test(readFileSync(p, 'utf8')));
    expect(direct).toEqual([]);
  });
});

describe('下のタブのバー（ジェスチャーナビゲーションのバーに重ならない）', () => {
  test('セーフエリアの下の幅を、高さと下の余白に足す', () => {
    expect(tabBarStyle(24)).toMatchObject({ height: TAB_BAR_HEIGHT + 24, paddingTop: 8, paddingBottom: 24 });
  });

  test('セーフエリアがない端末（web など）では、これまでと同じ高さ', () => {
    expect(tabBarStyle(0)).toMatchObject({ height: 72, paddingBottom: 0 });
  });
});
