/**
 * 前端统一配置模块 (ES Module + 全局 window.KY_CONFIG 双向兼容)
 */
export const APP_VERSION = 'v38';
export const ASSET_VERSION = `20271122_${APP_VERSION}`;
export const DEFAULT_BANK_ID = '2027_1000';

export const STORAGE_KEYS = Object.freeze({
  // 历史 v37 默认题库键（保持向后兼容与双向镜像）
  USER_DATA: 'quiz_user_data_2027',
  TOKEN: 'kaoyan_jwt_token_2027',
  USER_INFO: 'kaoyan_user_info_2027',
  LAST_SYNC_TIME: 'kaoyan_last_sync_time_2027',
  LAST_UPLOAD_HASH: 'kaoyan_last_upload_hash_2027',
  IS_DIRTY: 'kaoyan_is_dirty_2027',
  LAST_SESSION_CHECK: 'kaoyan_last_session_check_2027',
  FONT_SIZE: 'kaoyan_font_size_2027',
  THEME: 'kaoyan_theme_2027',
  CURRENT_BANK_ID: 'kaoyan_current_bank_id',
  MIGRATED_V38: 'kaoyan_migrated_v38_2027_1000'
});

/**
 * 按题库 bankId 获取隔离的 localStorage 键集
 */
export function getBankStorageKeys(bankId = DEFAULT_BANK_ID) {
  const safeId = (typeof bankId === 'string' && bankId.trim()) ? bankId.trim() : DEFAULT_BANK_ID;
  const isDefault = safeId === DEFAULT_BANK_ID;
  return Object.freeze({
    bankId: safeId,
    PROGRESS: `kaoyan_progress_${safeId}`,
    LEGACY_PROGRESS: isDefault ? STORAGE_KEYS.USER_DATA : null,
    LAST_SYNC_TIME: isDefault ? STORAGE_KEYS.LAST_SYNC_TIME : `kaoyan_last_sync_time_${safeId}`,
    LAST_UPLOAD_HASH: isDefault ? STORAGE_KEYS.LAST_UPLOAD_HASH : `kaoyan_last_upload_hash_${safeId}`,
    IS_DIRTY: isDefault ? STORAGE_KEYS.IS_DIRTY : `kaoyan_is_dirty_${safeId}`,
    CLOUD_VERSION: `kaoyan_cloud_version_${safeId}`,
    PENDING_OVERWRITE: `kaoyan_pending_overwrite_${safeId}`
  });
}

export const KY_CONFIG = Object.freeze({
  APP_VERSION,
  ASSET_VERSION,
  DEFAULT_BANK_ID,
  SYNC: Object.freeze({
    TIMEOUT_MS: 20000,                          // 单次请求超时
    MAX_RETRIES: 2,                             // 最大重试次数
    BACKOFF_MS: Object.freeze([1500, 3000])     // 指数退避间隔
  }),
  SESSION: Object.freeze({
    CHECK_INTERVAL_MS: 2 * 60 * 60 * 1000       // 会话校验节流：2 小时
  }),
  STORAGE_KEYS,
  getBankStorageKeys
});

if (typeof globalThis !== 'undefined') {
  globalThis.KY_CONFIG = KY_CONFIG;
}
