// Health Connect の権限の画面で「プライバシー ポリシー」を押したときの intent（react-native-health-connect の plugin が
// MainActivity に登録する）を、アプリのリンク torelog://health-privacy に変える。expo-router がその画面（app/health-privacy.tsx）を開く。
// - Android 13 まで：androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE
// - Android 14 から：android.intent.action.VIEW_PERMISSION_USAGE（ViewPermissionUsageActivity の alias から届く）
// どちらも URL を持たないので、そのままでは React Native の Linking に届かない（Linking は ACTION_VIEW の data だけを読む）
const { withMainActivity } = require('@expo/config-plugins');

const MARK = 'healthPrivacyLink';

const METHODS = `
  override fun onNewIntent(intent: Intent) {
    ${MARK}(intent)
    super.onNewIntent(intent)
  }

  // Health Connect の権限の説明の intent を、アプリのリンクに変える（plugins/withHealthPrivacyIntent.js）
  private fun ${MARK}(intent: Intent?) {
    val action = intent?.action ?: return
    if (action == "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" || action == "android.intent.action.VIEW_PERMISSION_USAGE") {
      intent.action = Intent.ACTION_VIEW
      intent.data = Uri.parse("torelog://health-privacy")
    }
  }
`;

function addImport(src, name) {
  return src.includes(`import ${name}\n`) ? src : src.replace(/^(package [^\n]+\n)/, `$1\nimport ${name}\n`);
}

module.exports = function withHealthPrivacyIntent(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== 'kt') throw new Error('withHealthPrivacyIntent: MainActivity が Kotlin ではありません');
    let src = mod.modResults.contents;
    if (src.includes(MARK)) return mod;
    if (/override fun onNewIntent/.test(src)) throw new Error('withHealthPrivacyIntent: MainActivity に onNewIntent がすでにあります');
    if (!/super\.onCreate\(/.test(src)) throw new Error('withHealthPrivacyIntent: MainActivity に super.onCreate がありません');
    src = addImport(addImport(src, 'android.content.Intent'), 'android.net.Uri');
    src = src.replace(/(\n\s*)super\.onCreate\(/, `$1${MARK}(intent)$1super.onCreate(`);
    src = src.replace(/\n}\s*$/, `\n${METHODS}}\n`);
    mod.modResults.contents = src;
    return mod;
  });
};
