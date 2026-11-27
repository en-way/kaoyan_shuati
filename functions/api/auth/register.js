import { generateSalt, hashPassword, signJwt } from '../../utils/auth.js';
import { jsonResponse, handleError, requireDb, readJsonBody, HttpError } from '../../utils/http.js';
import { normalizeUsername, assertRegisterUsername, assertPassword, sanitizeNickname, DEFAULT_BANK_ID } from '../../utils/validate.js';
import { MAX_AUTH_BODY_BYTES, PBKDF2_ITERATIONS, RATE_LIMIT_POLICIES } from '../../utils/constants.js';
import { ensureMultiBankSchema } from '../../utils/db-migrate.js';
import { getClientIp, assertNotRateLimited, recordRateLimitAttempt } from '../../utils/rate-limit.js';

export async function onRequestPost({ request, env }) {
  try {
    const db = requireDb(env);
    await ensureMultiBankSchema(db);
    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);

    const ip = getClientIp(request);
    const regBucket = `register_ip:${ip}`;
    const now = Date.now();
    await assertNotRateLimited(db, regBucket, now);

    const username = normalizeUsername(body.username);
    assertRegisterUsername(username);
    assertPassword(body.password);
    const nickname = sanitizeNickname(body.nickname, username);

    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existing) {
      throw new HttpError(409, '该账号已被注册，请直接登录或换一个账号');
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(body.password, salt, PBKDF2_ITERATIONS);
    const userId = crypto.randomUUID();
    const tokenVersion = 1;

    try {
      await db.batch([
        db.prepare(
          'INSERT INTO users (id, username, nickname, password_hash, salt, token_version, hash_iters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(userId, username, nickname, passwordHash, salt, tokenVersion, PBKDF2_ITERATIONS, now, now),
        db.prepare(
          'INSERT INTO user_progress (user_id, bank_id, answers_data, mistakes_data, stats_data, version, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
        ).bind(userId, DEFAULT_BANK_ID, '{}', '{}', '{}', now)
      ]);
    } catch (e) {
      if (/UNIQUE|constraint/i.test(String(e && e.message))) {
        throw new HttpError(409, '该账号已被注册，请直接登录或换一个账号');
      }
      throw e;
    }

    await recordRateLimitAttempt(db, regBucket, RATE_LIMIT_POLICIES.REGISTER_IP, now);

    const token = await signJwt({ id: userId, username, nickname, tv: tokenVersion }, env);

    return jsonResponse({
      success: true,
      token,
      updatedAt: now,
      user: { id: userId, username, nickname },
      message: '注册成功并已自动登录'
    });
  } catch (err) {
    return handleError(err, 'auth/register');
  }
}
