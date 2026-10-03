import { verifyPassword, signJwt } from '../../utils/auth.js';
import { jsonResponse, handleError, requireDb, readJsonBody, HttpError } from '../../utils/http.js';
import { normalizeUsername } from '../../utils/validate.js';
import { MAX_AUTH_BODY_BYTES, MAX_USERNAME_LENGTH, MAX_PASSWORD_LENGTH } from '../../utils/constants.js';

export async function onRequestPost({ request, env }) {
  try {
    const db = requireDb(env);
    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);

    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || username.length > MAX_USERNAME_LENGTH || !password || password.length > MAX_PASSWORD_LENGTH) {
      throw new HttpError(400, '请输入账号与密码');
    }

    const user = await db.prepare(
      'SELECT id, username, nickname, password_hash, salt FROM users WHERE username = ?'
    ).bind(username).first();

    // 账号不存在与密码错误返回同一文案与错误码；登录全程 0 次 D1 写入
    if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
      throw new HttpError(401, '账号不存在或密码错误', 'INVALID_CREDENTIALS');
    }

    const token = await signJwt({ id: user.id, username: user.username, nickname: user.nickname }, env);

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
