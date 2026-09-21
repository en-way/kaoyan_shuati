import {
  jsonResponse,
  errorResponse
} from '../../utils/auth.js';

// 开发与初始体验兜底密钥（建议在 Cloudflare Pages 后台配置自定义 ADMIN_SECRET）
export const DEFAULT_ADMIN_SECRET = 'KAOYAN_ADMIN_SECRET_2027';

export async function onRequestOptions() {
  return jsonResponse({}, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    // 允许空 body
  }

  const headerSecret = request.headers.get('x-admin-secret');
  const providedSecret = (headerSecret || body.adminSecret || '').trim();

  if (!providedSecret) {
    return errorResponse('请输入待测试的管理员密钥', 400);
  }

  // 优先读取 Cloudflare Pages 环境变量中配置的 ADMIN_SECRET
  const configuredSecret = env.ADMIN_SECRET ? env.ADMIN_SECRET.trim() : null;
  const isCustomConfigured = Boolean(configuredSecret);
  const activeSecret = configuredSecret || DEFAULT_ADMIN_SECRET;

  if (providedSecret !== activeSecret) {
    return jsonResponse({
      success: false,
      isValid: false,
      isCustomConfigured,
      error: '管理员密钥不匹配，请核对输入或检查 Cloudflare Pages 环境变量设置'
    }, 403);
  }

  return jsonResponse({
    success: true,
    isValid: true,
    isCustomConfigured,
    message: isCustomConfigured
      ? '✅ 密钥验证成功！当前正在使用 Cloudflare Pages 后台自定义配置的私密密钥。'
      : '⚠️ 密钥验证通过，但当前使用的是系统默认初始密钥。建议尽快前往 Cloudflare Pages 后台「设置 -> 环境变量」添加专属 ADMIN_SECRET 密钥！'
  });
}
