import {
  generateSalt,
  hashPassword,
  signJwt,
  jsonResponse,
  errorResponse
} from '../../utils/auth.js';

export async function onRequestOptions() {
  return jsonResponse({}, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return errorResponse('Cloudflare D1 数据库未绑定 (DB 未在 Pages 设置中绑定)', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('请求参数格式错误 (必须为有效 JSON)', 400);
  }

  let { username, nickname, password } = body || {};

  if (!username || typeof username !== 'string') {
    return errorResponse('请输入有效的账号/用户名', 400);
  }
  username = username.trim().toLowerCase();

  if (username.length < 3 || username.length > 32) {
    return errorResponse('账号长度须在 3 到 32 个字符之间', 400);
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return errorResponse('密码长度不能少于 6 位', 400);
  }

  nickname = (nickname && typeof nickname === 'string') ? nickname.trim() : username;
  if (nickname.length > 32) {
    nickname = nickname.substring(0, 32);
  }

  try {
    // 检查用户名是否重复
    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
      .bind(username)
      .first();

    if (existing) {
      return errorResponse('该账号已被注册，请直接登录或换一个账号', 409);
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(password, salt);
    const userId = crypto.randomUUID();
    const now = Date.now();

    // 原子事务写入 users 表与 user_progress 初始行 (减少 1 次网络往返，单次原子批处理提交)
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO users (id, username, nickname, password_hash, salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(userId, username, nickname, passwordHash, salt, now, now),
      env.DB.prepare(
        'INSERT INTO user_progress (user_id, answers_data, mistakes_data, stats_data, version, updated_at) VALUES (?, ?, ?, ?, 1, ?)'
      ).bind(userId, '{}', '{}', '{}', now)
    ]);

    // 签发 JWT
    const token = await signJwt({ id: userId, username, nickname }, env.JWT_SECRET);

    return jsonResponse({
      success: true,
      token,
      user: {
        id: userId,
        username,
        nickname
      },
      message: '注册成功并已自动登录'
    });
  } catch (err) {
    return errorResponse(`注册失败: ${err.message || err}`, 500);
  }
}
