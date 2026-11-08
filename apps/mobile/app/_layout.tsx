import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { NotoSansJP_400Regular } from '@expo-google-fonts/noto-sans-jp/400Regular';
import { NotoSansJP_700Bold } from '@expo-google-fonts/noto-sans-jp/700Bold';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteDatabase, SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { migrate } from '@/db';
import { AuthProvider } from '@/hooks/auth';
import { HealthConnectProvider } from '@/hooks/healthConnect';
import { SyncProvider } from '@/hooks/sync';
import { colors } from '@/theme';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

async function onInit(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrate(db);
}

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.accent, text: colors.text, border: colors.line },
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

  if (!loaded) return null;

  return (
    <SQLiteProvider databaseName="torelog.db" onInit={onInit}>
      <AuthProvider>
        <SyncProvider>
          <HealthConnectProvider>
            <ThemeProvider value={theme}>
              <StatusBar style="light" />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
                <Stack.Screen name="(tabs)" />
              </Stack>
            </ThemeProvider>
          </HealthConnectProvider>
        </SyncProvider>
      </AuthProvider>
    </SQLiteProvider>
  );
}
