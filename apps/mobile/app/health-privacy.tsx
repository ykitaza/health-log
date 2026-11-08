import { router } from 'expo-router';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Card, Header, SectionTitle } from '@/components/ui';
import { colors } from '@/theme';

/**
 * Health Connect の権限の説明（プライバシーポリシー）。Health Connect の権限の画面の「プライバシー ポリシー」から、
 * この画面が開く（plugins/withHealthPrivacyIntent.js が、その intent を torelog://health-privacy に変える）。設定からも開ける
 */
export default function HealthPrivacyScreen() {
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Screen>
      <Header title="Health Connect の使い方" onBack={back} />

      <SectionTitle title="読むもの" />
      <Card style={{ gap: 8 }}>
        <Item text="体重・体脂肪率・除脂肪体重（体重計の記録など）" />
        <Item text="睡眠（寝た時刻・起きた時刻・眠っていた時間）" />
        <Item text="心拍数と安静時心拍数" />
        <T size={12} color={colors.sub} style={{ lineHeight: 18 }}>
          読むだけで、Health Connect に書き込むことはありません。アプリを開いたときと、前面に戻ったときだけ読みます（バックグラウンドでは読みません）。
        </T>
      </Card>

      <SectionTitle title="送る先" />
      <Card style={{ gap: 8 }}>
        <T size={14} style={{ lineHeight: 21 }}>
          読んだ記録は、この端末に保存します。ログインしているときは、筋トレや食事の記録と同じく、本人の AWS のサーバーに送って同期します。ほかの会社や人には送りません。
        </T>
        <T size={14} style={{ lineHeight: 21 }}>
          心拍数は、1日ごとのまとめ（安静時・平均・最低・最高と、測った回数）だけを送ります。1回ごとの測った値（サンプル）は送りません。
        </T>
      </Card>

      <SectionTitle title="見られる人" />
      <Card style={{ gap: 8 }}>
        <T size={14} style={{ lineHeight: 21 }}>
          サーバーに送った記録は、本人がつないだチャット（Claude・ChatGPT の MCP のコネクタ）から読めます。チャットに体組成・睡眠・心拍を聞くと、その記録をもとに答えます。
        </T>
      </Card>

      <SectionTitle title="やめるとき" />
      <Card style={{ gap: 8 }}>
        <T size={14} style={{ lineHeight: 21 }}>
          設定の「Health Connect」で「連携を切る」を押すと、取り込みをやめます。権限は Health Connect のアプリからも外せます。取り込んだ記録は、体組成の画面で消せます（消したものは、取り込み直しても戻りません）。
        </T>
      </Card>
    </Screen>
  );
}

function Item({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <T size={14} color={colors.accent}>・</T>
      <T size={14} style={{ flex: 1, lineHeight: 21 }}>{text}</T>
    </View>
  );
}
