/**
 * 输入校验与规范化（集中管理，避免各接口各写一套）。
 */
import {
  MIN_USERNAME_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_NICKNAME_LENGTH
} from './constants.js';
import { HttpError } from './http.js';

export const DEFAULT_BANK_ID = '2027_1000';

// 允许：各语言字母、数字、_ . @ -
const USERNAME_RE = /^[\p{L}\p{N}_.@-]+$/u;
// 题库 ID：仅允许字母、数字、下划线、短横线，长度 1~32
const BANK_ID_RE = /^[a-zA-Z0-9_-]{1,32}$/;

export function normalizeUsername(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

// 仅注册时强校验字符集（登录不限制，保证历史账号不受影响）
export function assertRegisterUsername(username) {
  if (!username || username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) {
    throw new HttpError(400, `账号长度须在 ${MIN_USERNAME_LENGTH} 到 ${MAX_USERNAME_LENGTH} 个字符之间`, 'INVALID_USERNAME');
  }
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, '账号仅支持字母、数字及 _ . @ - 符号', 'INVALID_USERNAME');
  }
}

export function assertPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `密码长度不能少于 ${MIN_PASSWORD_LENGTH} 位`, 'INVALID_PASSWORD');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `密码长度不能超过 ${MAX_PASSWORD_LENGTH} 位`, 'INVALID_PASSWORD');
  }
}

// 昵称：去控制字符与尖括号（纵深防御，前端本身用 textContent 渲染），截断到上限
export function sanitizeNickname(raw, fallback) {
  let nickname = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim() : '';
  if (!nickname) nickname = fallback;
  return nickname.slice(0, MAX_NICKNAME_LENGTH);
}

/**
 * 规范化并校验 bankId：
 * - 未传、null、undefined 或空字符串时，自动回退到 DEFAULT_BANK_ID ('2027_1000')，100% 兼容老客户端；
 * - 若显式传入非空值，则必须匹配 /^[a-zA-Z0-9_-]{1,32}$/。
 */
export function resolveBankId(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_BANK_ID;
  }
  if (typeof raw !== 'string') {
    throw new HttpError(400, '无效的题库标识格式', 'INVALID_BANK_ID');
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return DEFAULT_BANK_ID;
  }
  if (!BANK_ID_RE.test(trimmed) || trimmed === '__proto__' || trimmed === 'constructor') {
    throw new HttpError(400, '题库标识仅允许字母、数字、下划线与短横线（长度 ≤ 32）', 'INVALID_BANK_ID');
  }
  return trimmed;
}
