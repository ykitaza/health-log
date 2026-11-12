import { useState } from 'react';
import { Image } from 'react-native';
import { photoOrNull } from '@/lib/profile';
import { colors } from '@/theme';

/**
 * 丸いアカウントの写真。写真を置いていなければ（読めなかったときも）アプリのアイコンを丸く切り抜いて出す。
 * 読み上げは押せるもの（呼ぶ側）に付けるので、ここは画像として読ませない
 */
export function Avatar({ uri, size }: { uri: string | null; size: number }) {
  const photo = photoOrNull(uri);
  // 読めなかった写真（ファイルが消えたなど）。別の写真に変わったら、もう一度読む
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = photo != null && failed !== photo;
  return (
    <Image
      source={showPhoto ? { uri: photo } : require('@/assets/images/icon.png')}
      onError={() => { if (photo) setFailed(photo); }}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.input }}
      accessible={false}
      testID={showPhoto ? 'avatar-photo' : 'avatar-icon'}
    />
  );
}
