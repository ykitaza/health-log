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
  - 皮膚（skin）から性器をなくした（2026-11-17）。股の前の楕円体（中心 (0, 0.805, 0.045)、半径 (0.05, 0.065, 0.07)）の中の 171 頂点だけを、
    まわりの皮膚につながる曲がりの少ない面（双調和の面）に置き直し、その頂点と隣の頂点（計 221）の法線を作り直した。頂点と三角形は消していない（穴も縫い目もない。
    皮膚は 9,801 頂点・29,941 三角形のまま）。筋肉の部品は動かしていない
  - 腹筋（abs）の上の縁を、大胸筋の下の縁の丸い形に合わせた（2026-11-17）。四角く切り出した腹筋の上の端が大胸筋の下の部分の前に重なり、
    胸の下の縁が四角く削れて見えていたため。大胸筋の下の縁（x 5mm ごと）より 4mm 上、またはみぞおちの高さ 1.235m より上にある
    腹筋の三角形を消した（1,858 → 1,114。頂点の数と並びはそのまま）
  - この 2 つは `tools/body-model/edit-body-glb.mjs` で、元の body.glb（2f6f7cc の版）から同じ形に作り直せる：
    `git show 2f6f7cc:apps/mobile/assets/models/body.glb > /tmp/body-orig.glb && node tools/body-model/edit-body-glb.mjs /tmp/body-orig.glb apps/karada/assets/models/body.glb`
- アプリでは、ケガの画面の体の図の下に、出典とライセンス・元のデータへのリンクを出す（components/InjuryBodyMap3D.native.tsx）
