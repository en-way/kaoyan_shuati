import { generateSalt, hashPassword, signJwt } from '../../utils/auth.js';
import { jsonResponse, handleError, requireDb, readJsonBody, HttpError } from '../../utils/http.js';
import { normalizeUsername, assertRegisterUsername, assertPassword, sanitizeNickname } from '../../utils/validate.js';
import { MAX_AUTH_BODY_BYTES } from '../../utils/constants.js';

export async function onRequestPost({ request, env }) {
  try {
    const db = requireDb(env);
    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);

    const username = normalizeUsername(body.username);
    assertRegisterUsername(username);
    assertPassword(body.password);
    const nickname = sanitizeNickname(body.nickname, username);

    // 先查重只为给出友好提示；真正的并发防线是 UNIQUE 约束（见下方 catch）
    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existing) {
      throw new HttpError(409, '该账号已被注册，请直接登录或换一个账号');
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(body.password, salt);
    const userId = crypto.randomUUID();
    const now = Date.now();

    // 原子事务：users + user_progress 初始行，一次往返
    try {
      await db.batch([
        db.prepare(
          'INSERT INTO users (id, username, nickname, password_hash, salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(userId, username, nickname, passwordHash, salt, now, now),
        db.prepare(
          'INSERT INTO user_progress (user_id, answers_data, mistakes_data, stats_data, version, updated_at) VALUES (?, ?, ?, ?, 1, ?)'
        ).bind(userId, '{}', '{}', '{}', now)
      ]);
    } catch (e) {
      // 并发注册同名账号：UNIQUE 约束冲突 => 409，而不是 500
      if (/UNIQUE|constraint/i.test(String(e && e.message))) {
        throw new HttpError(409, '该账号已被注册，请直接登录或换一个账号');
      }
      throw e;
    }

    const token = await signJwt({ id: userId, username, nickname }, env);

    return jsonResponse({
      success: true,
      token,
      user: { id: userId, username, nickname },
      message: '注册成功并已自动登录'
    });
  } catch (err) {
    return handleError(err, 'auth/register');
  }
}
