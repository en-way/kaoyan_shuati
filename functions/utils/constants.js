/**
 * 后端统一常量：消除各文件中的魔数与硬编码。
 */

// ---- JWT ----
export const JWT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 天
export const JWT_CLOCK_SKEW_MS = 0;               // 已启用 token_version 精确吊销，归零时间容差
// 历史上写在公开仓库中的兜底密钥：永远拒绝使用（即使有人把它配成 JWT_SECRET）
export const LEGACY_DEFAULT_JWT_SECRET = 'kaoyan2027_production_jwt_signing_fallback_key';

// ---- 密码哈希 (Cloudflare Free 10ms CPU 约束下的 PBKDF2 迭代数) ----
export const PBKDF2_ITERATIONS = 20000;
export const DUMMY_SALT_HEX = '0123456789abcdef0123456789abcdef';
export const DUMMY_PASSWORD_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// ---- 密码重置码 ----
export const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 分钟
export const RESET_CODE_TTL_MINUTES = 15;
export const RESET_CODE_MAX_ATTEMPTS = 5;

// ---- 防爆破限流策略 ----
export const RATE_LIMIT_POLICIES = Object.freeze({
  LOGIN_USER: { maxFails: 10, windowMs: 10 * 60 * 1000, lockMs: 10 * 60 * 1000 },
  LOGIN_IP: { maxFails: 25, windowMs: 10 * 60 * 1000, lockMs: 10 * 60 * 1000 },
  REGISTER_IP: { maxFails: 10, windowMs: 60 * 60 * 1000, lockMs: 60 * 60 * 1000 },
  RESET_IP: { maxFails: 12, windowMs: 10 * 60 * 1000, lockMs: 15 * 60 * 1000 },
  ADMIN_IP: { maxFails: 8, windowMs: 10 * 60 * 1000, lockMs: 15 * 60 * 1000 }
});

// ---- 时钟防伪造上限 (允许客户端最多超前 24 小时) ----
export const MAX_FUTURE_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

// ---- 输入约束 ----
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 32;
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 128; // 防超长密码放大 PBKDF2 CPU
export const MAX_NICKNAME_LENGTH = 32;

// ---- 请求体大小上限 (字节) ----
export const MAX_AUTH_BODY_BYTES = 4096;
export const MAX_SYNC_BODY_BYTES = 256 * 1024; // 全书 1148 题满进度约 25KB，256KB 留足余量
