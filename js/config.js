/**
 * 前端统一配置：消除 app.js 中散落的魔数与存储键字面量。
 */
(function (global) {
  'use strict';

  global.KY_CONFIG = Object.freeze({
    SYNC: Object.freeze({
      TIMEOUT_MS: 20000,                          // 单次请求超时
      MAX_RETRIES: 2,                             // 最大重试次数
      BACKOFF_MS: Object.freeze([1500, 3000])     // 指数退避间隔
    }),
    SESSION: Object.freeze({
      CHECK_INTERVAL_MS: 2 * 60 * 60 * 1000       // 会话校验节流：2 小时
    }),
    STORAGE_KEYS: Object.freeze({
      USER_DATA: 'quiz_user_data_2027',
      TOKEN: 'kaoyan_jwt_token_2027',
      USER_INFO: 'kaoyan_user_info_2027',
      LAST_SYNC_TIME: 'kaoyan_last_sync_time_2027',
      LAST_UPLOAD_HASH: 'kaoyan_last_upload_hash_2027',
      IS_DIRTY: 'kaoyan_is_dirty_2027',
      LAST_SESSION_CHECK: 'kaoyan_last_session_check_2027',
      FONT_SIZE: 'kaoyan_font_size_2027'
    })
  });
})(window);
