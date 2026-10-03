/**
 * 管理员鉴权（generate-reset-code 与 verify-secret 共用，消除重复代码）。
 * 仅依赖 env.ADMIN_SECRET；未配置则拒绝（不再有任何内置默认密钥）。
 */
import { timingSafeEqualStr } from './auth.js';
import { HttpError, ErrorCode } from './http.js';

export async function assertAdmin(request, env, body) {
  const configured = typeof env.ADMIN_SECRET === 'string' ? env.ADMIN_SECRET.trim() : '';
  if (!configured) {
    throw new HttpError(
      500,
      '服务端尚未配置 ADMIN_SECRET，管理员功能未启用。请前往 Cloudflare Pages「设置 -> 环境变量」添加后重新部署。',
      ErrorCode.CONFIG_ERROR
    );
  }

  const provided = String(request.headers.get('x-admin-secret') || (body && body.adminSecret) || '').trim();
  if (!provided) {
    throw new HttpError(400, '请输入管理员密钥', ErrorCode.BAD_REQUEST);
  }

  if (!(await timingSafeEqualStr(provided, configured))) {
    throw new HttpError(403, '管理员密钥错误，无权执行此操作', ErrorCode.FORBIDDEN);
  }
}
