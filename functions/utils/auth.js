/**
 * 考研政治 1000 题 · 原生 Web Crypto 安全工具库
 * 零第三方 npm 依赖，完美兼容 Cloudflare Pages / Workers 原生执行环境
 */

// 辅助：Uint8Array 转 Hex 字符串
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 辅助：Hex 字符串转 Uint8Array
export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// 辅助：Base64URL 编码与解码
export function base64UrlEncode(str) {
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// 1. 生成 16 字节安全随机盐
export function generateSalt() {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return bytesToHex(salt);
}

// 2. PBKDF2 安全密码哈希配置 (Cloudflare Free 版 10ms CPU 最佳实践：20,000 次；同时向下兼容 100,000 次)
export const PBKDF2_DEFAULT_ITERATIONS = 20000;
export const PBKDF2_LEGACY_ITERATIONS = 100000;

export async function hashPassword(password, saltHex, iterations = PBKDF2_DEFAULT_ITERATIONS) {
  const enc = new TextEncoder();
  const passKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const saltBytes = hexToBytes(saltHex);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: iterations,
      hash: 'SHA-256'
    },
    passKey,
    256
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

// 3. 校验密码是否匹配（先使用 20k 次迭代快速比对，未匹配时向下兼容 100k 次旧账号）
export async function verifyPassword(password, saltHex, targetHash) {
  const hash = await hashPassword(password, saltHex, PBKDF2_DEFAULT_ITERATIONS);
  if (hash === targetHash) return true;
  // 向下兼容历史 100k 迭代账号
  const legacyHash = await hashPassword(password, saltHex, PBKDF2_LEGACY_ITERATIONS);
  return legacyHash === targetHash;
}

// 4. 生成 6 位纯数字密码重置码 (100000 ~ 999999)
export function generate6DigitCode() {
  const randomBuffer = new Uint32Array(1);
  crypto.getRandomValues(randomBuffer);
  const code = 100000 + (randomBuffer[0] % 900000);
  return code.toString();
}

// 4.5. 恒定时间字符串比对（防御时序侧信道反推秘钥/重置码）
export async function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const hashA = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(a)));
  const hashB = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(b)));
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= (hashA[i] ^ hashB[i]);
  }
  return diff === 0;
}

// JWT 签名密钥默认兜底（在用户未在 Cloudflare Pages 后台配置 JWT_SECRET 时保障开箱即用）
export const DEFAULT_JWT_SECRET = 'kaoyan2027_production_jwt_signing_fallback_key';

export function getJwtSecret(secretOrEnv) {
  if (typeof secretOrEnv === 'string' && secretOrEnv.trim()) {
    return secretOrEnv.trim();
  }
  if (secretOrEnv && typeof secretOrEnv === 'object' && secretOrEnv.JWT_SECRET && typeof secretOrEnv.JWT_SECRET === 'string' && secretOrEnv.JWT_SECRET.trim()) {
    return secretOrEnv.JWT_SECRET.trim();
  }
  return DEFAULT_JWT_SECRET;
}

// 5. JWT HMAC-SHA256 签发 (有效期默认 30 天)
export async function signJwt(payload, secretOrEnv) {
  const secret = getJwtSecret(secretOrEnv);
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30天
  const fullPayload = { ...payload, exp };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(dataToSign)
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${dataToSign}.${encodedSignature}`;
}

// 6. JWT HMAC-SHA256 校验与解析
export async function verifyJwt(token, secretOrEnv) {
  if (!token || typeof token !== 'string') return null;
  const secret = getJwtSecret(secretOrEnv);
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    let base64Sig = signature.replace(/-/g, '+').replace(/_/g, '/');
    while (base64Sig.length % 4) base64Sig += '=';
    const sigBinary = atob(base64Sig);
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      enc.encode(dataToSign)
    );

    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null; // 已过期
    }
    return payload;
  } catch (e) {
    return null;
  }
}

// 从请求头获取当前登录用户
export async function getAuthUser(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  const secret = getJwtSecret(env);
  return await verifyJwt(token, secret);
}

// 统一 JSON 响应封装
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-secret'
    }
  });
}

export function errorResponse(message, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}
