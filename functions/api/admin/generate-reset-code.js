import {
  generate6DigitCode,
  jsonResponse,
  errorResponse,
  timingSafeEqualStr
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
      '服务端安全限制：Cloudflare Pages 环境变量中尚未配置 ADMIN_SECRET，管理员功能未启用。请前往 Cloudflare Pages 后台「设置 -> 环境变量」添加 ADMIN_SECRET 密钥后再使用。',
      500
    );
  }

  if (!providedSecret) {
    return errorResponse('请输入管理员密钥', 400);
  }

  const isMatch = await timingSafeEqualStr(providedSecret, configuredSecret);
  if (!isMatch) {
    return errorResponse('管理员口令/密钥错误，无权生成重置码', 403);
  }

  let username = (body.username || '').trim().toLowerCase();
  if (!username) {
    return errorResponse('请输入需要重置密码的学员账号/用户名', 400);
  }

  try {
    // 兼容历史部署：确保 password_resets 表具备 failed_attempts 字段
    try {
      await env.DB.prepare('ALTER TABLE password_resets ADD COLUMN failed_attempts INTEGER DEFAULT 0').run();
    } catch (e) {
      // 字段已存在时忽略错误
    }

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
    const expiresAt = now + (15 * 60 * 1000); // 15分钟有效 (高安全方案)

    // 插入新重置码记录，并顺便原子清理已过期或已使用的旧记录，防止数据表长期膨胀
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO password_resets (id, username, code, created_at, expires_at, used, failed_attempts) VALUES (?, ?, ?, ?, ?, 0, 0)'
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
      expiresInMinutes: 15,
      message: `重置码生成成功！请在 15 分钟内发给学员使用（连续输错 5 次将作废）。`
    });
  } catch (err) {
    return errorResponse(`生成重置码失败: ${err.message || err}`, 500);
  }
}
