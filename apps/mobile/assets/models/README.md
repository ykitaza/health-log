# body.glb（ケガの画面の 3D の体）

- 元のデータ：BodyParts3D 4.0, © The Database Center for Life Science（DBCLS）
  - 公式の README（2025-02-27 更新）の表記：CC Attribution 4.0 International（CC BY 4.0）
  - 注意：配布の OBJ の見出しには CC BY-SA 2.1 JP とある。公式の README の CC BY 4.0 に従って使い、表記は両方を残しておく
- 手を入れたこと（改変）
  - 筋肉を 36 の部品にまとめ、頂点を減らした（全体でおよそ 11.4 万の三角形）
  - 脊柱起立筋は、高さ 1060mm（元の座標）で上部と腰部に分けた
  - 腹直筋と広背筋は 4.0 にないので、皮膚の形から範囲を切り出して代わりにした
  - 単位をメートルに、上を +y、顔の向きを +z にした（本人の右が −x）
- アプリでは、ケガの画面の体の図の下に出典を出す（components/InjuryBodyMap3D.native.tsx）
