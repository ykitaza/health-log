# フォント

| ファイル | 書体 | 使うところ | ライセンス |
|---|---|---|---|
| `ShareTechMono-Regular.ttf` | Share Tech Mono（Carrois Type Design, Ralph du Carrois） | レポート詳細の等幅の数字と英字のラベル（`components/report/hud.tsx` の `HudFonts`） | SIL Open Font License 1.1（`OFL.txt`） |

- 入手元：[google/fonts の ofl/sharetechmono](https://github.com/google/fonts/tree/main/ofl/sharetechmono)
- `expo-font` の `useFonts` で JS から読み込む（app.json の expo-font のプラグインには入れない）。ネイティブの依存とアプリの fingerprint は変わらない
- 読み込む前・読み込めなかったときは、システムの monospace で描く
