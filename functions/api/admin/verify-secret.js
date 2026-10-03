import { assertAdmin } from '../../utils/admin.js';
import { jsonResponse, handleError, readJsonBody, HttpError, ErrorCode } from '../../utils/http.js';
import { MAX_AUTH_BODY_BYTES } from '../../utils/constants.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES).catch(() => ({}));
    await assertAdmin(request, env, body);

    return jsonResponse({
      success: true,
      isValid: true,
      isCustomConfigured: true,
      message: '✅ 密钥验证成功！已成功连接 Cloudflare Pages 后台配置的私密管理员密钥。'
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({
        success: false,
        isValid: false,
        isCustomConfigured: err.code !== ErrorCode.CONFIG_ERROR,
        error: err.message,
        code: err.code
      }, err.status);
    }
    return handleError(err, 'admin/verify-secret');
  }
}
