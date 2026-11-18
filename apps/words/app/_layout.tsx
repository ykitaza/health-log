import { NotoSansJP_400Regular } from '@expo-google-fonts/noto-sans-jp/400Regular';
import { NotoSansJP_700Bold } from '@expo-google-fonts/noto-sans-jp/700Bold';
import { ShipporiMincho_400Regular } from '@expo-google-fonts/shippori-mincho/400Regular';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteDatabase, SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { DB_NAME, migrate } from '@/db';
import { AuthProvider } from '@/hooks/auth';
import { ListenProvider } from '@/hooks/listen';
import { NotificationsProvider } from '@/hooks/notifications';
import { SyncProvider } from '@/hooks/sync';
import { colors } from '@/theme';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

async function onInit(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrate(db);
}

// 紙の地（明るいテーマだけ）
const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.paper, card: colors.paper, primary: colors.accent, text: colors.ink, border: colors.line },
};

export default function RootLayout() {
  // 文字は expo-font でアプリに入れる（Shippori Mincho・Noto Sans JP。どちらも SIL Open Font License 1.1）
  const [loaded, error] = useFonts({ ShipporiMincho_400Regular, NotoSansJP_400Regular, NotoSansJP_700Bold });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  const reduced = useReducedMotion();

  if (!loaded) return null;

  return (
    <SQLiteProvider databaseName={DB_NAME} onInit={onInit}>
      <AuthProvider>
        <SyncProvider>
          <NotificationsProvider>
          <ListenProvider>
            <ThemeProvider value={theme}>
              <StatusBar style="dark" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.paper },
                  animation: reduced ? 'fade' : 'ios_from_right',
                  animationDuration: reduced ? 150 : 250,
                }}
              >
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
              </Stack>
            </ThemeProvider>
          </ListenProvider>
          </NotificationsProvider>
        </SyncProvider>
      </AuthProvider>
    </SQLiteProvider>
  );
}
