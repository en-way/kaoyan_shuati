/**
 * 后端统一常量：消除各文件中的魔数与硬编码。
 */

// ---- JWT ----
export const JWT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 天
export const JWT_CLOCK_SKEW_MS = 5000;            // iat 与 users.updated_at 比较的时钟容差
// 历史上写在公开仓库中的兜底密钥：永远拒绝使用（即使有人把它配成 JWT_SECRET）
export const LEGACY_DEFAULT_JWT_SECRET = 'kaoyan2027_production_jwt_signing_fallback_key';

// ---- 密码哈希 (Cloudflare Free 10ms CPU 约束下的 PBKDF2 迭代数) ----
export const PBKDF2_ITERATIONS = 20000;

// ---- 密码重置码 ----
export const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 分钟
export const RESET_CODE_TTL_MINUTES = 15;
export const RESET_CODE_MAX_ATTEMPTS = 5;

// ---- 输入约束 ----
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 32;
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 128; // 防超长密码放大 PBKDF2 CPU
export const MAX_NICKNAME_LENGTH = 32;

// ---- 请求体大小上限 (字节) ----
export const MAX_AUTH_BODY_BYTES = 4096;
export const MAX_SYNC_BODY_BYTES = 256 * 1024; // 全书 1148 题满进度约 25KB，256KB 留足余量
