// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      // 外す理由：DB から非同期に読んだ値で、入力欄や選んだ日を埋め直すところ（settings.tsx、history.tsx）で使っている。
      // 描くときに値を出す形へ書き直すと、入力中の値を消さない決まり（読み込んだときと単位を変えたときだけ埋める）を
      // 作り直すことになるので、今回は外す。書き込みの入口を1つにするとき（第2段階）に見直す
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
