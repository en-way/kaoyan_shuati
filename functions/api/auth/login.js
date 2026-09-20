import {
  verifyPassword,
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

  let { username, password } = body || {};

  if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
    return errorResponse('请输入账号与密码', 400);
  }
  username = username.trim().toLowerCase();

  try {
    const user = await env.DB.prepare(
      'SELECT id, username, nickname, password_hash, salt FROM users WHERE username = ?'
    ).bind(username).first();

    if (!user) {
      return errorResponse('账号不存在或密码错误', 401);
    }

    const isMatch = await verifyPassword(password, user.salt, user.password_hash);
    if (!isMatch) {
      return errorResponse('账号不存在或密码错误', 401);
    }

    // 签发 JWT (免写 D1 数据库，节约每日 10 万行写入配额)
    const token = await signJwt(
      { id: user.id, username: user.username, nickname: user.nickname },
      env.JWT_SECRET
    );

    return jsonResponse({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname
      },
      message: '登录成功'
    });
  } catch (err) {
    return errorResponse(`登录失败: ${err.message || err}`, 500);
  }
}
