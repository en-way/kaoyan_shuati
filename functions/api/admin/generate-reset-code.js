import {
  generate6DigitCode,
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

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    // allow empty body if params in header
  }

  const headerSecret = request.headers.get('x-admin-secret');
  const providedSecret = (headerSecret || body.adminSecret || '').trim();

  const configuredSecret = env.ADMIN_SECRET ? env.ADMIN_SECRET.trim() : null;

  if (!configuredSecret) {
    return errorResponse(
      'Cloudflare Pages 环境变量中尚未配置 ADMIN_SECRET。请前往 Pages 设置 -> 环境变量 中添加 ADMIN_SECRET 密钥后再试。',
      500
    );
  }

  if (providedSecret !== configuredSecret) {
    return errorResponse('管理员口令/密钥错误，无权生成重置码', 403);
  }

  let username = (body.username || '').trim().toLowerCase();
  if (!username) {
    return errorResponse('请输入需要重置密码的学员账号/用户名', 400);
  }

  try {
    // 检查学员用户是否存在
    const user = await env.DB.prepare(
      'SELECT id, username, nickname FROM users WHERE username = ?'
    ).bind(username).first();

    if (!user) {
      return errorResponse(`未找到账号为「${username}」的学员，请核对账号是否正确`, 404);
    }

    // 生成 6 位随机重置码
    const code = generate6DigitCode();
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + (30 * 60 * 1000); // 30分钟有效

    // 插入新重置码记录，并顺便原子清理已过期或已使用的旧记录，防止数据表长期膨胀
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO password_resets (id, username, code, created_at, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)'
      ).bind(id, username, code, now, expiresAt),
      env.DB.prepare(
        'DELETE FROM password_resets WHERE expires_at < ? OR used = 1'
      ).bind(now)
    ]);

    return jsonResponse({
      success: true,
      code,
      username: user.username,
      nickname: user.nickname,
      expiresAt,
      expiresInMinutes: 30,
      message: `重置码生成成功！请在 30 分钟内发给学员使用。`
    });
  } catch (err) {
    return errorResponse(`生成重置码失败: ${err.message || err}`, 500);
  }
}
