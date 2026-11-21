// web では Health Connect を使わない（ライブラリを読み込まない）。画面は「Android だけ」と出す
import type * as Native from './client';

export const supported = false;

const unsupported = () => { throw new Error('Health Connect は Android だけで使えます'); };

export const aggregateRecord: typeof Native.aggregateRecord = unsupported;
export const getChanges: typeof Native.getChanges = unsupported;
export const getGrantedPermissions: typeof Native.getGrantedPermissions = unsupported;
export const getSdkStatus: typeof Native.getSdkStatus = unsupported;
export const initialize: typeof Native.initialize = unsupported;
export const openHealthConnectSettings: typeof Native.openHealthConnectSettings = unsupported;
export const readRecords: typeof Native.readRecords = unsupported;
export const requestPermission: typeof Native.requestPermission = unsupported;
export const revokeAllPermissions: typeof Native.revokeAllPermissions = unsupported;
export const HISTORY_PERMISSION: typeof Native.HISTORY_PERMISSION = 'android.permission.health.READ_HEALTH_DATA_HISTORY';
export const hasHistoryPermission: typeof Native.hasHistoryPermission = async () => false;
export const SdkAvailabilityStatus = { SDK_UNAVAILABLE: 1, SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2, SDK_AVAILABLE: 3 } as const;
