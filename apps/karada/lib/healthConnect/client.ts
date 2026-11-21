// Health Connect（Android）を読むところ。react-native-health-connect の、使う関数だけを出す。
// web では client.web.ts を使う（ライブラリを読み込まない）。iOS では supported が false なので呼ばない
import { PermissionsAndroid, Permission as AndroidPermission, Platform } from 'react-native';
import {
  aggregateRecord, getChanges, getGrantedPermissions, getSdkStatus, initialize, openHealthConnectSettings,
  readRecords, requestPermission, revokeAllPermissions, SdkAvailabilityStatus,
} from 'react-native-health-connect';

/** この端末で Health Connect を使えるか（Android だけ） */
export const supported = Platform.OS === 'android';

export {
  aggregateRecord, getChanges, getGrantedPermissions, getSdkStatus, initialize, openHealthConnectSettings,
  readRecords, requestPermission, revokeAllPermissions, SdkAvailabilityStatus,
};

/** 30日より前の記録を読む許可（Health Connect の READ_HEALTH_DATA_HISTORY）。app.json の android.permissions にも書く */
export const HISTORY_PERMISSION = 'android.permission.health.READ_HEALTH_DATA_HISTORY';

/**
 * 30日より前の記録を読む許可があるか。react-native-health-connect の getGrantedPermissions は、この許可を返さない（4.1.3）ので、
 * Android の権限として確かめる（Android 14 からは、Health Connect の許可は Android の権限になっている）。
 * Android 13 まで（Health Connect が別のアプリ）は false になり、今までどおり30日分だけ読む
 */
export async function hasHistoryPermission(): Promise<boolean> {
  if (!supported) return false;
  try {
    return await PermissionsAndroid.check(HISTORY_PERMISSION as AndroidPermission);
  } catch {
    return false;
  }
}
