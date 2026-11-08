// Health Connect（Android）を読むところ。react-native-health-connect の、使う関数だけを出す。
// web では client.web.ts を使う（ライブラリを読み込まない）。iOS では supported が false なので呼ばない
import { Platform } from 'react-native';
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
