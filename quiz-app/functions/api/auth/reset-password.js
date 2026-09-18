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

  let { username, code, newPassword } = body || {};

  if (!username || typeof username !== 'string') {
    return errorResponse('请输入账号', 400);
  }
  username = username.trim().toLowerCase();

  if (!code || typeof code !== 'string') {
    return errorResponse('请输入 6 位密码重置码', 400);
  }
  code = code.trim();

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    return errorResponse('新密码长度不能少于 6 位', 400);
  }

  try {
    // 1. 查询重置码记录
    const resetRecord = await env.DB.prepare(
      'SELECT id, expires_at, used FROM password_resets WHERE username = ? AND code = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(username, code).first();

    if (!resetRecord) {
      return errorResponse('重置码不存在或无效，请核对账号与重置码', 400);
    }

    if (resetRecord.used === 1) {
      return errorResponse('该重置码已被使用，不能重复使用。请联系管理员重新获取', 400);
    }

    const now = Date.now();
    if (now > resetRecord.expires_at) {
      return errorResponse('重置码已过期（有效期为 30 分钟），请联系管理员重新生成', 400);
    }

    // 2. 查询用户
    const user = await env.DB.prepare(
      'SELECT id, username, nickname FROM users WHERE username = ?'
    ).bind(username).first();

    if (!user) {
      return errorResponse('关联的用户不存在', 404);
    }

    // 3. 生成新盐与新哈希
    const newSalt = generateSalt();
    const newPasswordHash = await hashPassword(newPassword, newSalt);

    // 4. 更新密码并使当前重置码作废 (单次使用)
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?'
      ).bind(newPasswordHash, newSalt, now, user.id),
      env.DB.prepare(
        'UPDATE password_resets SET used = 1 WHERE id = ?'
      ).bind(resetRecord.id)
    ]);

    // 5. 签发全新 JWT 凭证，实现重置后自动静默登录
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
      message: '密码重置成功！已自动为您登录并恢复学习'
    });
  } catch (err) {
    return errorResponse(`重置密码失败: ${err.message || err}`, 500);
  }
}
