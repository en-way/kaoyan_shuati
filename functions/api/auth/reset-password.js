import {
  generateSalt,
  hashPassword,
  hashResetCode,
  signJwt,
  timingSafeEqualStr
} from '../../utils/auth.js';
import { jsonResponse, handleError, requireDb, readJsonBody, HttpError } from '../../utils/http.js';
import { normalizeUsername, assertPassword } from '../../utils/validate.js';
import {
  MAX_AUTH_BODY_BYTES,
  PBKDF2_ITERATIONS,
  RESET_CODE_MAX_ATTEMPTS,
  RATE_LIMIT_POLICIES
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
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!username) throw new HttpError(400, '请输入账号');
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, '请输入 6 位数字密码重置码');
    assertPassword(body.newPassword);

    const ip = getClientIp(request);
    const resetBucket = `reset_ip:${ip}`;
    const now = Date.now();
    await assertNotRateLimited(db, resetBucket, now);

    // 1. 取该账号最新且未使用的重置码记录
    const record = await db.prepare(
      'SELECT id, code, expires_at, failed_attempts FROM password_resets WHERE username = ? AND used = 0 ORDER BY created_at DESC LIMIT 1'
    ).bind(username).first();

    if (!record) {
      await recordRateLimitAttempt(db, resetBucket, RATE_LIMIT_POLICIES.RESET_IP, now);
      throw new HttpError(400, '该账号暂无有效的密码重置码，请联系管理员重新获取', 'RESET_CODE_MISSING');
    }
    if (now > record.expires_at) {
      await recordRateLimitAttempt(db, resetBucket, RATE_LIMIT_POLICIES.RESET_IP, now);
      throw new HttpError(400, '重置码已过期，请联系管理员重新生成', 'RESET_CODE_EXPIRED');
    }

    // 2. 原子抢占「尝试名额」
    const claim = await db.prepare(
      'UPDATE password_resets SET failed_attempts = failed_attempts + 1 WHERE id = ? AND used = 0 AND failed_attempts < ? AND expires_at > ?'
    ).bind(record.id, RESET_CODE_MAX_ATTEMPTS, now).run();

    if (!claim.meta || claim.meta.changes !== 1) {
      await recordRateLimitAttempt(db, resetBucket, RATE_LIMIT_POLICIES.RESET_IP, now);
      throw new HttpError(400, '重置码已失效（输错次数过多或已过期），请联系管理员重新生成', 'RESET_CODE_LOCKED');
    }

    // 3. 恒定时间比对 HMAC 后的重置码
    const givenHash = await hashResetCode(username, code, env);
    if (!(await timingSafeEqualStr(givenHash, record.code))) {
      await recordRateLimitAttempt(db, resetBucket, RATE_LIMIT_POLICIES.RESET_IP, now);
      const attemptNo = (record.failed_attempts || 0) + 1;
      const remain = Math.max(0, RESET_CODE_MAX_ATTEMPTS - attemptNo);
      throw new HttpError(
        400,
        remain > 0
          ? `重置码错误，请重新核对（还剩 ${remain} 次尝试机会）`
          : '重置码错误且尝试次数已用尽，该重置码已作废，请联系管理员重新生成',
        'RESET_CODE_INVALID'
      );
    }

    const user = await db.prepare('SELECT id, username, nickname, token_version FROM users WHERE username = ?')
      .bind(username).first();
    if (!user) throw new HttpError(404, '关联的用户不存在');

    // 4. 原子「消费」重置码
    const consume = await db.prepare(
      'UPDATE password_resets SET used = 1 WHERE id = ? AND used = 0'
    ).bind(record.id).run();
    if (!consume.meta || consume.meta.changes !== 1) {
      throw new HttpError(400, '该重置码已被使用，请联系管理员重新生成', 'RESET_CODE_USED');
    }

    // 5. 更新密码 + 原子自增 token_version（0 毫秒精确吊销所有旧 JWT）并清理过期记录
    const newSalt = generateSalt();
    const newHash = await hashPassword(body.newPassword, newSalt, PBKDF2_ITERATIONS);
    const nextTv = (Number.isFinite(user.token_version) ? user.token_version : 1) + 1;
    await db.batch([
      db.prepare('UPDATE users SET password_hash = ?, salt = ?, token_version = ?, hash_iters = ?, updated_at = ? WHERE id = ?')
        .bind(newHash, newSalt, nextTv, PBKDF2_ITERATIONS, now, user.id),
      db.prepare('DELETE FROM password_resets WHERE expires_at < ?').bind(now)
    ]);

    await clearRateLimit(db, resetBucket);

    const token = await signJwt({ id: user.id, username: user.username, nickname: user.nickname, tv: nextTv }, env);

    return jsonResponse({
      success: true,
      token,
      user: { id: user.id, username: user.username, nickname: user.nickname },
      message: '密码重置成功！已自动为您登录并恢复学习'
    });
  } catch (err) {
    return handleError(err, 'auth/reset-password');
  }
}
