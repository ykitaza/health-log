# body.glb（ケガの画面の 3D の体）

- 元のデータ：BodyParts3D 4.0, © The Database Center for Life Science（DBCLS）
  - データベースの説明：https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html
  - DOI：10.18908/lsdba.nbdc00837-000
- ライセンス：CC Attribution 4.0 International（CC BY 4.0）
  - https://creativecommons.org/licenses/by/4.0/
  - 公式のライセンスのページ（2025-02-27 更新）：https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
  - 配布の OBJ の見出しにある CC BY-SA 2.1 JP は古い表記。公式のライセンスのページに従い、CC BY 4.0 とする
  - 表記の文言（公式の指定）："BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International"
- 手を入れたこと（改変）
  - 筋肉を 36 の部品にまとめ、頂点を減らした（全体でおよそ 11.4 万の三角形）
  - 脊柱起立筋は、高さ 1060mm（元の座標）で上部と腰部に分けた
  - 腹直筋と広背筋は 4.0 にないので、皮膚の形から範囲を切り出して代わりにした
  - 単位をメートルに、上を +y、顔の向きを +z にした（本人の右が −x）
- アプリでは、ケガの画面の体の図の下に、出典とライセンス・元のデータへのリンクを出す（components/InjuryBodyMap3D.native.tsx）
