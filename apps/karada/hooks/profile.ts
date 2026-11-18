import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { useFocusData } from '@/hooks/data';
import { choosePhoto, normalizeDisplayName, PhotoDeps, removePhoto } from '@/lib/profile';

/**
 * 写真を選んで置く処理（端末）。選ぶのは Android の Photo Picker（許可は要らない）。正方形に切り抜き、品質は落とす。
 * 置き場所はアプリの中（document の profile/）。web では動かない（E2E では選ぶ操作は試さない）
 */
const photoDeps: PhotoDeps = {
  async pick() {
    const r = await launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (r.canceled || r.assets.length === 0) return null;
    const { uri, width, height } = r.assets[0];
    return { uri, width, height };
  },
  async shrink(uri, size) {
    const ctx = ImageManipulator.manipulate(uri);
    if (size) ctx.resize(size);
    const image = await ctx.renderAsync();
    return (await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 })).uri;
  },
  async save(uri) {
    const dir = new Directory(Paths.document, 'profile');
    dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, `photo-${Date.now()}.jpg`);
    await new File(uri).copy(dest);
    return dest.uri;
  },
  async remove(uri) {
    const f = new File(uri);
    if (f.exists) f.delete();
  },
};

/**
 * 表示名と写真（端末だけ。同期しない・サーバーに送らない）。画面が前に出るたびに読み直すので、
 * アカウントの画面で変えたものは、戻ったときにホームや設定に出る
 */
export function useProfile() {
  const { data, reload, repos } = useFocusData((r) => r.settings.accountProfile());
  const photoUri = data?.photoUri ?? null;
  const put = async (uri: string | null) => { await repos.settings.setAccountProfile({ photoUri: uri }); await reload(); };
  return {
    loaded: data != null,
    displayName: data?.displayName ?? null,
    photoUri,
    /** 入れた文字を置く（前後の空白を除き、空なら消す） */
    async setDisplayName(text: string) {
      await repos.settings.setAccountProfile({ displayName: normalizeDisplayName(text) });
      await reload();
    },
    /** 端末の写真から選んで置く。やめたら false */
    pickPhoto: () => choosePhoto(photoDeps, photoUri, put),
    /** 写真を外して、アプリのアイコンに戻す */
    removePhoto: () => removePhoto(photoDeps, photoUri, put),
  };
}
