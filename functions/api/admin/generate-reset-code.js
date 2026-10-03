import { generate6DigitCode, hashResetCode } from '../../utils/auth.js';
import { assertAdmin } from '../../utils/admin.js';
import { jsonResponse, handleError, requireDb, readJsonBody, HttpError } from '../../utils/http.js';
import { normalizeUsername } from '../../utils/validate.js';
import { MAX_AUTH_BODY_BYTES, RESET_CODE_TTL_MS, RESET_CODE_TTL_MINUTES } from '../../utils/constants.js';

export async function onRequestPost({ request, env }) {
  try {
    const db = requireDb(env);
    // 允许仅用请求头携带密钥的空 body
    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES).catch(() => ({}));
    await assertAdmin(request, env, body);

    const username = normalizeUsername(body.username);
    if (!username) throw new HttpError(400, '请输入需要重置密码的学员账号/用户名');

    const user = await db.prepare('SELECT id, username, nickname FROM users WHERE username = ?')
      .bind(username).first();
    if (!user) {
      throw new HttpError(404, `未找到账号为「${username}」的学员，请核对账号是否正确`);
    }

    const code = generate6DigitCode();
    const now = Date.now();
    const expiresAt = now + RESET_CODE_TTL_MS;
    // 库中只存 HMAC，明文码仅在本次响应中返回一次
    const codeHash = await hashResetCode(user.username, code, env);

    // 原子批处理：作废旧码 -> 写入新码 -> 清理过期/已用记录
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
    return handleError(err, 'admin/generate-reset-code');
  }
}
