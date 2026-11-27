import { assertAdmin } from '../../utils/admin.js';
import { jsonResponse, handleError, readJsonBody, HttpError, ErrorCode } from '../../utils/http.js';
import { MAX_AUTH_BODY_BYTES, RATE_LIMIT_POLICIES } from '../../utils/constants.js';
import { ensureMultiBankSchema } from '../../utils/db-migrate.js';
import {
  getClientIp,
  assertNotRateLimited,
  recordRateLimitAttempt,
  clearRateLimit
} from '../../utils/rate-limit.js';

export async function onRequestPost({ request, env }) {
  const db = env && env.DB ? env.DB : null;
  const ip = getClientIp(request);
  const adminBucket = `admin_ip:${ip}`;
  const now = Date.now();

  try {
    if (db) {
      await ensureMultiBankSchema(db);
      await assertNotRateLimited(db, adminBucket, now);
    }

    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES, { allowEmpty: true });
    await assertAdmin(request, env, body);

    if (db) await clearRateLimit(db, adminBucket);

    return jsonResponse({
      success: true,
      isValid: true,
      message: '✅ 密钥验证成功！已成功连接 Cloudflare Pages 后台配置的私密管理员密钥。'
    });
  } catch (err) {
    if (err instanceof HttpError) {
      if (db && err.code === ErrorCode.FORBIDDEN) {
        await recordRateLimitAttempt(db, adminBucket, RATE_LIMIT_POLICIES.ADMIN_IP, now);
      }
      return jsonResponse({
        success: false,
        isValid: false,
        error: err.message,
        code: err.code
      }, err.status);
    }
    return handleError(err, 'admin/verify-secret');
  }
}
