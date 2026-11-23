/**
 * 云端认证与多题库同步调度聚合入口 (js/core/sync.js)
 * 聚合 auth-ui、admin-ui、cloud-sync 三个子模块，保持 App.auth.* 对外接口 100% 向后兼容。
 */
import { KY_CONFIG } from '../config.js';
import { createAuthUiMethods } from './auth-ui.js';
import { createAdminUiMethods } from './admin-ui.js';
import { createCloudSyncMethods } from './cloud-sync.js';

export function createAuthController(getApp) {
  return {
    currentUser: null,
    token: (typeof localStorage !== 'undefined' && localStorage.getItem(KY_CONFIG.STORAGE_KEYS.TOKEN)) || null,
    isDirty: false,
    lastSyncTime: null,
    isSyncing: false,
    isNetworkWeak: false,
    retryStatusText: '',
    _lastAdminResult: null,

    ...createAuthUiMethods(getApp),
    ...createAdminUiMethods(getApp),
    ...createCloudSyncMethods(getApp)
  };
}
