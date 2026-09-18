import {
  getAuthUser,
  jsonResponse,
  errorResponse
} from '../../utils/auth.js';

export async function onRequestOptions() {
  return jsonResponse({}, 200);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const authUser = await getAuthUser(request, env);
  if (!authUser) {
    return errorResponse('未登录或登录已过期', 401);
  }

  if (!env.DB) {
    return jsonResponse({
      success: true,
      user: authUser
    });
  }

  try {
    const user = await env.DB.prepare(
      'SELECT id, username, nickname, updated_at FROM users WHERE id = ?'
    ).bind(authUser.id).first();

    if (!user) {
      return errorResponse('用户不存在', 404);
    }

    return jsonResponse({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        updatedAt: user.updated_at
      }
    });
  } catch (e) {
    return errorResponse(`查询用户信息失败: ${e.message || e}`, 500);
  }
}
