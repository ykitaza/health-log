/**
 * 端末の読み上げをファイルに書き出す小さなモジュール（Android だけ。android/ の KotobaTtsModule.kt）。
 * iOS・web・jest ではモジュールがないので null（呼ぶ側は expo-speech でその場で読む）
 */
import { requireOptionalNativeModule } from 'expo';

type KotobaTtsApi = {
  isAvailable(): Promise<boolean>;
  /** 書き終えたら path を返す（WAV） */
  synthesizeToFile(text: string, path: string, rate: number): Promise<string>;
};

export const KotobaTts = requireOptionalNativeModule<KotobaTtsApi>('KotobaTts');
