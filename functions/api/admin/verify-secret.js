import {
  jsonResponse,
  errorResponse,
  timingSafeEqualStr
} from '../../utils/auth.js';

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

  // 读取 Cloudflare Pages 环境变量中配置的 ADMIN_SECRET
  const configuredSecret = env.ADMIN_SECRET ? env.ADMIN_SECRET.trim() : null;

  if (!configuredSecret) {
    return jsonResponse({
      success: false,
      isValid: false,
      isCustomConfigured: false,
      error: 'Cloudflare Pages 后台尚未配置 ADMIN_SECRET 环境变量。请前往 Cloudflare Pages 后台「设置 -> 环境变量」添加 ADMIN_SECRET 密钥后再测试。'
    }, 500);
  }

  const isMatch = await timingSafeEqualStr(providedSecret, configuredSecret);
  if (!isMatch) {
    return jsonResponse({
      success: false,
      isValid: false,
      isCustomConfigured: true,
      error: '管理员密钥不匹配，请核对输入或检查 Cloudflare Pages 环境变量设置'
    }, 403);
  }

  return jsonResponse({
    success: true,
    isValid: true,
    isCustomConfigured: true,
    message: '✅ 密钥验证成功！已成功连接 Cloudflare Pages 后台配置的私密管理员密钥。'
  });
}
