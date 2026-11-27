import { verifyPassword, verifyDummyPassword, signJwt } from '../../utils/auth.js';
import { jsonResponse, handleError, requireDb, readJsonBody, HttpError } from '../../utils/http.js';
import { normalizeUsername } from '../../utils/validate.js';
import {
  MAX_AUTH_BODY_BYTES,
  MAX_USERNAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  RATE_LIMIT_POLICIES,
  PBKDF2_ITERATIONS
} from '../../utils/constants.js';
import { ensureMultiBankSchema } from '../../utils/db-migrate.js';
import {
  getClientIp,
  assertNotRateLimited,
  recordRateLimitAttempt,
  clearRateLimit
} from '../../utils/rate-limit.js';

export async function onRequestPost({ request, env }) {
  try {
    const db = requireDb(env);
    await ensureMultiBankSchema(db);
    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);

    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || username.length > MAX_USERNAME_LENGTH || !password || password.length > MAX_PASSWORD_LENGTH) {
      throw new HttpError(400, '请输入账号与密码');
    }

    const ip = getClientIp(request);
    const ipBucket = `login_ip:${ip}`;
    const userBucket = `login_user:${ip}:${username}`;
    const now = Date.now();
    await assertNotRateLimited(db, ipBucket, now);
    await assertNotRateLimited(db, userBucket, now);

    const user = await db.prepare(
      'SELECT id, username, nickname, password_hash, salt, token_version, hash_iters FROM users WHERE username = ?'
    ).bind(username).first();

    let passwordOk = false;
    if (!user) {
      await verifyDummyPassword(password);
    } else {
      passwordOk = await verifyPassword(password, user.salt, user.password_hash, user.hash_iters || PBKDF2_ITERATIONS);
    }

    if (!user || !passwordOk) {
      await recordRateLimitAttempt(db, ipBucket, RATE_LIMIT_POLICIES.LOGIN_IP, now);
      await recordRateLimitAttempt(db, userBucket, RATE_LIMIT_POLICIES.LOGIN_USER, now);
      throw new HttpError(401, '账号不存在或密码错误', 'INVALID_CREDENTIALS');
    }

    await clearRateLimit(db, userBucket);

    const tv = Number.isFinite(user.token_version) ? user.token_version : 1;
    const token = await signJwt({ id: user.id, username: user.username, nickname: user.nickname, tv }, env);

    return jsonResponse({
      success: true,
      token,
      user: { id: user.id, username: user.username, nickname: user.nickname },
      message: '登录成功'
    });
  } catch (err) {
    return handleError(err, 'auth/login');
  }
}
