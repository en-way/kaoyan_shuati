import { generate6DigitCode, hashResetCode } from '../../utils/auth.js';
import { assertAdmin } from '../../utils/admin.js';
import { jsonResponse, handleError, requireDb, readJsonBody, HttpError, ErrorCode } from '../../utils/http.js';
import { normalizeUsername } from '../../utils/validate.js';
import { MAX_AUTH_BODY_BYTES, RESET_CODE_TTL_MS, RESET_CODE_TTL_MINUTES, RATE_LIMIT_POLICIES } from '../../utils/constants.js';
import { ensureMultiBankSchema } from '../../utils/db-migrate.js';
import {
  getClientIp,
  assertNotRateLimited,
  recordRateLimitAttempt,
  clearRateLimit
} from '../../utils/rate-limit.js';

export async function onRequestPost({ request, env }) {
  let db = null;
  const ip = getClientIp(request);
  const adminBucket = `admin_ip:${ip}`;
  const now = Date.now();

  try {
    db = requireDb(env);
    await ensureMultiBankSchema(db);
    await assertNotRateLimited(db, adminBucket, now);

    // 允许仅用请求头携带密钥且请求体为空，但仍严格拦截格式错误的 JSON 或超大请求体
    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES, { allowEmpty: true });
    await assertAdmin(request, env, body);
    await clearRateLimit(db, adminBucket);

    const username = normalizeUsername(body.username);
    if (!username) throw new HttpError(400, '请输入需要重置密码的学员账号/用户名');

    const user = await db.prepare('SELECT id, username, nickname FROM users WHERE username = ?')
      .bind(username).first();
    if (!user) {
      throw new HttpError(404, `未找到账号为「${username}」的学员，请核对账号是否正确`);
    }

    const code = generate6DigitCode();
    const expiresAt = now + RESET_CODE_TTL_MS;
    const codeHash = await hashResetCode(user.username, code, env);

    await db.batch([
      db.prepare('UPDATE password_resets SET used = 1 WHERE username = ? AND used = 0').bind(user.username),
      db.prepare(
        'INSERT INTO password_resets (id, username, code, created_at, expires_at, used, failed_attempts) VALUES (?, ?, ?, ?, ?, 0, 0)'
      ).bind(crypto.randomUUID(), user.username, codeHash, now, expiresAt),
      db.prepare('DELETE FROM password_resets WHERE expires_at < ? OR used = 1').bind(now)
    ]);

    return jsonResponse({
      success: true,
      code,
      username: user.username,
      nickname: user.nickname,
      expiresAt,
      expiresInMinutes: RESET_CODE_TTL_MINUTES,
      message: `重置码生成成功！请在 ${RESET_CODE_TTL_MINUTES} 分钟内发给学员使用（连续输错 5 次将作废）。`
    });
  } catch (err) {
    if (db && err instanceof HttpError && err.code === ErrorCode.FORBIDDEN) {
      await recordRateLimitAttempt(db, adminBucket, RATE_LIMIT_POLICIES.ADMIN_IP, now);
    }
    return handleError(err, 'admin/generate-reset-code');
  }
}
