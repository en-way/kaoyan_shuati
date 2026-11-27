import { getAuthUser, isTokenRevoked } from '../../utils/auth.js';
import { jsonResponse, errorResponse, handleError, requireDb, ErrorCode } from '../../utils/http.js';
import { ensureMultiBankSchema } from '../../utils/db-migrate.js';

export async function onRequestGet({ request, env }) {
  try {
    const authUser = await getAuthUser(request, env);
    if (!authUser) {
      return errorResponse('未登录或登录已过期', 401, ErrorCode.UNAUTHORIZED);
    }

    const db = requireDb(env);
    await ensureMultiBankSchema(db);
    const user = await db.prepare(
      'SELECT id, username, nickname, updated_at, token_version FROM users WHERE id = ?'
    ).bind(authUser.id).first();

    if (!user) {
      return errorResponse('账号在云端已被删除，本地数据将自动清空', 404, ErrorCode.USER_DELETED);
    }

    if (isTokenRevoked(authUser, user.updated_at, user.token_version)) {
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
