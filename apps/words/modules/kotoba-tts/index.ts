/**
 * 端末の読み上げをファイルに書き出す小さなモジュール（Android だけ。android/ の KotobaTtsModule.kt）。
 * iOS・web・jest ではモジュールがないので null（呼ぶ側は expo-speech でその場で読む）
 */
import { requireOptionalNativeModule } from 'expo';

type KotobaTtsApi = {
  isAvailable(): Promise<boolean>;
  /**
   * 日本語の読み上げをファイルに書き出せるか。書き出せれば null、書き出せなければ理由（画面に出す）。
   * 最初の preview の APK にはないので、呼ぶ前にあるかを確かめる
   */
  diagnose?(): Promise<string | null>;
  /** 書き終えたら path を返す（WAV）。書き出せなければ、理由を message に入れて reject する */
  synthesizeToFile(text: string, path: string, rate: number): Promise<string>;
};

export const KotobaTts = requireOptionalNativeModule<KotobaTtsApi>('KotobaTts');
