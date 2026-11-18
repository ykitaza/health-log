import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { NotoSansJP_400Regular } from '@expo-google-fonts/noto-sans-jp/400Regular';
import { NotoSansJP_700Bold } from '@expo-google-fonts/noto-sans-jp/700Bold';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteDatabase, SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { migrate } from '@/db';
import { DB_NAME } from '@/db/name';
import { AuthProvider } from '@/hooks/auth';
import { HealthConnectProvider } from '@/hooks/healthConnect';
import { SyncProvider } from '@/hooks/sync';
import { colors, isHud } from '@/theme';
import { duration } from '@/theme/motion';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

async function onInit(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrate(db);
}

// クラシックは紙の地（明るいテーマ。ナビゲーションの地と文字も紙と墨）
const base = isHud ? DarkTheme : DefaultTheme;
const theme = {
  ...base,
  colors: { ...base.colors, background: colors.bg, card: colors.bg, primary: colors.accent, text: colors.text, border: colors.line },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    NotoSansJP_400Regular, NotoSansJP_700Bold, BarlowCondensed_600SemiBold, BarlowCondensed_700Bold,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  // 画面は右からすべって入り、戻るときは右へ抜ける。Android は ios_from_right（200ms・行き帰り同じ。長さは端末の決まり）、
  // iOS は animationDuration で 250ms。動きを減らす設定なら切り替えるだけ
  const reduced = useReducedMotion();

  if (!loaded) return null;

  return (
    <SQLiteProvider databaseName={DB_NAME} onInit={onInit}>
      <AuthProvider>
        <SyncProvider>
          <HealthConnectProvider>
            <ThemeProvider value={theme}>
              {/* クラシックは紙の地なので、状態バーのアイコンを暗くする（スプラッシュは暗いまま） */}
              <StatusBar style={isHud ? 'light' : 'dark'} />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg },
                  animation: reduced ? 'none' : 'ios_from_right',
                  animationDuration: duration.toggle,
                }}
              >
                <Stack.Screen name="(tabs)" />
              </Stack>
            </ThemeProvider>
          </HealthConnectProvider>
        </SyncProvider>
      </AuthProvider>
    </SQLiteProvider>
  );
}
