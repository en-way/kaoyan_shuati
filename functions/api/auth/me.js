import { getAuthUser } from '../../utils/auth.js';
import { jsonResponse, errorResponse, handleError, requireDb, ErrorCode } from '../../utils/http.js';
import { JWT_CLOCK_SKEW_MS } from '../../utils/constants.js';

export async function onRequestGet({ request, env }) {
  try {
    const authUser = await getAuthUser(request, env);
    if (!authUser) {
      return errorResponse('未登录或登录已过期', 401, ErrorCode.UNAUTHORIZED);
    }

    const db = requireDb(env);
    const user = await db.prepare(
      'SELECT id, username, nickname, updated_at FROM users WHERE id = ?'
    ).bind(authUser.id).first();

    if (!user) {
      return errorResponse('账号在云端已被删除，本地数据将自动清空', 404, ErrorCode.USER_DELETED);
    }

    // 吊销检查：Token 签发早于最近一次改密(users.updated_at) => 视为已吊销。
    // 无 iat 的历史 Token 不在此检查范围，30 天内自然过期。
    if (authUser.iat && authUser.iat * 1000 + JWT_CLOCK_SKEW_MS < user.updated_at) {
      return errorResponse('密码已变更，请重新登录', 401, ErrorCode.TOKEN_REVOKED);
    }

    return jsonResponse({
      success: true,
      user: { id: user.id, username: user.username, nickname: user.nickname, updatedAt: user.updated_at }
    });
  } catch (err) {
    return handleError(err, 'auth/me');
  }
}
