import { router } from 'expo-router';
import { View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Button, Screen, T } from '@/components/ui';
import { useRepos } from '@/hooks/data';
import { SIGN_IN_MESSAGES, useSignIn } from '@/hooks/signIn';
import { colors, space } from '@/theme';

/**
 * 初めの画面（Figma の 7-signin・7c・7d）。パスキーでログイン（KARADA と同じアカウント）か、ログインせずに使う。
 * 新しくアカウントを作る道はない（使うのは本人だけ）
 */
export default function WelcomeScreen() {
  const repos = useRepos();
  const enter = async () => {
    await repos.local.setWelcomed();
    router.replace('/');
  };
  const { signIn, busy, error } = useSignIn(() => { void enter(); });

  return (
    <Screen scroll={false} testID="welcome-screen" footer={(
      <View style={{ gap: space.m }}>
        {error && (
          <View style={{ flexDirection: 'row', gap: space.m, alignItems: 'flex-start' }} accessibilityRole="alert" testID="signin-error">
            {error === 'offline' && <Icon name="wifiOff" size={24} color={colors.sub} />}
            <T variant="body" style={{ flex: 1 }}>{SIGN_IN_MESSAGES[error]}</T>
          </View>
        )}
        <Button label={error ? 'もう一度ログイン' : 'パスキーでログイン'} onPress={signIn} busy={busy} testID="signin" />
        <T variant="bodyS" color={colors.sub} style={{ textAlign: 'center' }}>KARADA と同じアカウント。同じパスキーでそのまま入れます</T>
        <Button label="ログインせずに使う" variant="text" onPress={enter} testID="skip-signin" />
        <T variant="bodyS" color={colors.sub} style={{ textAlign: 'center' }}>ログインしなくても、この端末だけで使えます</T>
      </View>
    )}>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.l }}>
        <T variant="wordXL" style={{ fontSize: 48, lineHeight: 64, letterSpacing: 8 }} accessibilityRole="header">ことば</T>
        <T variant="wordS" color={colors.sub} style={{ lineHeight: 34 }}>本や会話で出会った言葉を拾い、{'\n'}自分の言葉にしていく</T>
      </View>
    </Screen>
  );
}
