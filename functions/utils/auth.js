/**
 * 考研政治 1000 题 · 原生 Web Crypto 安全工具库
 * 零第三方 npm 依赖，完美兼容 Cloudflare Pages / Workers 原生执行环境
 */
import {
  JWT_TTL_SECONDS,
  LEGACY_DEFAULT_JWT_SECRET,
  PBKDF2_ITERATIONS,
  DUMMY_SALT_HEX,
  DUMMY_PASSWORD_HASH,
  MAX_PASSWORD_LENGTH
} from './constants.js';
import { ErrorCode } from './http.js';

// 向后兼容：sync.js 仍从 auth.js 引入这两个函数
export { jsonResponse, errorResponse } from './http.js';

// 配置缺失异常（handleError 会统一转为 500 且不泄露细节）
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.code = ErrorCode.CONFIG_ERROR;
  }
}

// ---------- 编码辅助 ----------
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64UrlEncode(str) {
  return bytesToBase64Url(new TextEncoder().encode(str));
}

export function base64UrlDecode(str) {
  return new TextDecoder().decode(base64UrlToBytes(str));
}

// ---------- 密码哈希 (PBKDF2-SHA256) ----------
export function generateSalt() {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return bytesToHex(salt);
}

export async function hashPassword(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const passKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    passKey,
    256
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

// 恒定时间字符串比对（防时序侧信道）
export async function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const hashA = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(a)));
  const hashB = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(b)));
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= hashA[i] ^ hashB[i];
  return diff === 0;
}

// 单次 PBKDF2 校验，且改用恒定时间比较哈希（支持每账号独立 iterations）
export async function verifyPassword(password, saltHex, targetHash, iterations = PBKDF2_ITERATIONS) {
  if (
    typeof password !== 'string' ||
    password.length > MAX_PASSWORD_LENGTH ||
    typeof saltHex !== 'string' ||
    saltHex.length === 0 ||
    saltHex.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(saltHex) ||
    typeof targetHash !== 'string'
  ) {
    return false;
  }
  const iters = Number.isFinite(iterations) && iterations >= 1000 ? Math.floor(iterations) : PBKDF2_ITERATIONS;
  const hash = await hashPassword(password, saltHex, iters);
  return timingSafeEqualStr(hash, targetHash);
}

// 账号不存在时执行等耗时口令校验，防止登录接口时序枚举用户名
export async function verifyDummyPassword(password) {
  const safePass = (typeof password === 'string' && password.length > 0 && password.length <= MAX_PASSWORD_LENGTH)
    ? password
    : 'dummy_constant_time_probe';
  return verifyPassword(safePass, DUMMY_SALT_HEX, DUMMY_PASSWORD_HASH, PBKDF2_ITERATIONS);
}

/**
 * 统一 JWT 吊销校验（0 秒时间窗）：
 * - 优先使用 token_version (tv)：严格比对 tv === user.token_version；
 * - 兼容尚未升级的无 tv 历史 Token：若密码已被改过（token_version > 1）立即吊销，否则严格校验 iat。
 */
export function isTokenRevoked(authUser, userUpdatedAt, userTokenVersion = null) {
  if (!authUser) return true;
  const hasUserTv = typeof userTokenVersion === 'number' && Number.isFinite(userTokenVersion);
  const hasTokenTv = typeof authUser.tv === 'number' && Number.isFinite(authUser.tv);
  if (hasUserTv) {
    if (hasTokenTv) return authUser.tv !== userTokenVersion;
    if (userTokenVersion > 1) return true;
  }
  if (!userUpdatedAt) return false;
  if (!Number.isFinite(authUser.iat) || authUser.iat <= 0) return true;
  return authUser.iat < Math.floor(userUpdatedAt / 1000);
}

// ---------- 随机重置码 ----------
// 6 位纯数字 (100000~999999)，使用拒绝采样消除取模偏差
export function generate6DigitCode() {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 900000) * 900000;
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return String(100000 + (buf[0] % 900000));
}

// ---------- JWT 密钥（fail-closed） ----------
// 绝不再使用任何内置兜底密钥：未配置/配置成历史公开默认值 => 抛 ConfigError
export function getJwtSecret(secretOrEnv) {
  const raw = typeof secretOrEnv === 'string'
    ? secretOrEnv
    : (secretOrEnv && secretOrEnv.JWT_SECRET);
  const secret = typeof raw === 'string' ? raw.trim() : '';
  if (!secret) {
    throw new ConfigError('JWT_SECRET 环境变量未配置');
  }
  if (secret === LEGACY_DEFAULT_JWT_SECRET) {
    throw new ConfigError('JWT_SECRET 不得使用仓库中公开的历史默认值');
  }
  if (secret.length < 32) {
    console.warn('[Security Warning] JWT_SECRET 长度不足 32 字符，建议更换为 32 位以上随机串');
  }
  return secret;
}

// HMAC 密钥导入结果按 secret 缓存（同一 isolate 内复用，节省每请求 CPU）
const hmacKeyCache = new Map();
function getHmacKey(secret) {
  let pending = hmacKeyCache.get(secret);
  if (!pending) {
    pending = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    hmacKeyCache.set(secret, pending);
  }
  return pending;
}

// 通用 HMAC-SHA256 十六进制摘要（用于重置码加盐存储）
export async function hmacSha256Hex(secretOrEnv, message) {
  const key = await getHmacKey(getJwtSecret(secretOrEnv));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

// 重置码入库形态：HMAC(secret, "reset:<username>:<code>")，库泄露也无法反推 6 位码
export function hashResetCode(username, code, secretOrEnv) {
  return hmacSha256Hex(secretOrEnv, `reset:${username}:${code}`);
}

// ---------- JWT ----------
export async function signJwt(payload, secretOrEnv) {
  const key = await getHmacKey(getJwtSecret(secretOrEnv));
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const fullPayload = { ...payload, iat: now, exp: now + JWT_TTL_SECONDS };

  const dataToSign = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(fullPayload))}`;
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataToSign));
  return `${dataToSign}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

// 校验失败一律返回 null；密钥缺失抛 ConfigError（由调用方处理）
export async function verifyJwt(token, secretOrEnv) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const key = await getHmacKey(getJwtSecret(secretOrEnv));
  const [encodedHeader, encodedPayload, signature] = parts;

  try {
    // 严格要求 header.alg === HS256，拒绝 none 等其他算法
    const header = JSON.parse(base64UrlDecode(encodedHeader));
    if (!header || header.alg !== 'HS256') return null;

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    );
    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// 从请求头获取当前登录用户；ConfigError 向上抛出交由 handleError 转 500，避免服务端配置问题误发 401 清空用户本地进度
export async function getAuthUser(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  return verifyJwt(token, env);
}
