// UI スレッドで動く関数（'worklet'）の書き方の決まり。jest では worklet が普通の関数として動くので、実機でだけ落ちる書き方をここで止める
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const DIRS = ['lib', 'components', 'app', 'hooks'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('worklet の関数は、引数の既定値に外の名前を使わない（UI スレッドへ持ち込まれず ReferenceError で落ちる）', () => {
  const bad: string[] = [];
  for (const file of DIRS.flatMap((d) => sources(join(ROOT, d)))) {
    const text = readFileSync(file, 'utf8');
    // function 名(引数) { 'worklet'; … の引数の部分
    for (const m of text.matchAll(/function\s+(\w+)\s*\(([^)]*)\)[^{]*\{\s*'worklet'/g)) {
      const params = m[2];
      // 「= 名前」の既定値（数や文字の決まった値は除く）
      if (/=\s*[A-Za-z_$]/.test(params.replace(/=>/g, ''))) bad.push(`${file.replace(ROOT, '')}: ${m[1]}(${params.trim()})`);
    }
  }
  expect(bad).toEqual([]);
});
