/**
 * 端末の通知（expo-notifications）を包む。web には端末の通知がないので notifier.web.ts が何もしない。
 * 正確な時刻のアラーム（SCHEDULE_EXACT_ALARM）は使わない（数分ずれてもよい）。サーバーからのプッシュは使わない
 */
import {
  addNotificationResponseReceivedListener, AndroidImportance, cancelAllScheduledNotificationsAsync, clearLastNotificationResponse,
  getLastNotificationResponse, getPermissionsAsync, requestPermissionsAsync, scheduleNotificationAsync, SchedulableTriggerInputTypes,
  setNotificationChannelAsync, setNotificationHandler,
} from 'expo-notifications';
import { Platform } from 'react-native';
import type { Notifier } from './reschedule';

const CHANNEL = 'review';
const ID = 'kotoba-review';

setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export const notifier: Notifier = {
  async permitted() {
    const p = await getPermissionsAsync();
    return p.granted;
  },
  async request() {
    if (Platform.OS === 'android') {
      await setNotificationChannelAsync(CHANNEL, { name: '聞く', importance: AndroidImportance.DEFAULT });
    }
    const p = await requestPermissionsAsync();
    return p.granted;
  },
  async schedule(at, title, body) {
    await cancelAllScheduledNotificationsAsync();
    await scheduleNotificationAsync({
      identifier: ID,
      content: { title, body, data: { open: 'review' } },
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
    });
  },
  async cancel() {
    await cancelAllScheduledNotificationsAsync();
  },
  onOpen(listener) {
    const sub = addNotificationResponseReceivedListener(() => listener());
    // 閉じていたアプリを通知から開いたとき
    const last = getLastNotificationResponse();
    if (last) {
      listener();
      clearLastNotificationResponse();
    }
    return () => sub.remove();
  },
};
