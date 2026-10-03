/**
 * 统一 HTTP 响应、错误码与请求体读取。
 *
 * 说明：应用前端与 Functions 同源部署，因此不输出任何 CORS 头，
 * 浏览器会阻止其他站点跨域调用本 API。
 */

// 统一业务错误码（前端据此判断，不再依赖中文文案）
export const ErrorCode = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  USER_DELETED: 'USER_DELETED',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFIG_ERROR: 'CONFIG_ERROR',
  SERVER_ERROR: 'SERVER_ERROR'
});

const STATUS_TO_CODE = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  429: ErrorCode.RATE_LIMITED,
  500: ErrorCode.SERVER_ERROR
};

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: BASE_HEADERS });
}

// 统一错误体：{ success:false, error:<给用户看的文案>, code:<机器可读错误码> }
export function errorResponse(message, status = 400, code) {
  return jsonResponse(
    { success: false, error: message, code: code || STATUS_TO_CODE[status] || ErrorCode.SERVER_ERROR },
    status
  );
}

// 业务异常：在处理流程中 throw，由 handleError 统一转为响应
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code || STATUS_TO_CODE[status] || ErrorCode.SERVER_ERROR;
  }
}

// 统一异常出口：已知业务异常原样返回；未知异常只记日志，绝不把内部信息返回客户端
export function handleError(err, label) {
  if (err instanceof HttpError) {
    return errorResponse(err.message, err.status, err.code);
  }
  if (err && err.code === ErrorCode.CONFIG_ERROR) {
    console.error(`[${label}] 配置错误:`, err.message);
    return errorResponse('服务端配置缺失，请联系管理员', 500, ErrorCode.CONFIG_ERROR);
  }
  console.error(`[${label}]`, err);
  return errorResponse('服务器内部错误，请稍后重试', 500, ErrorCode.SERVER_ERROR);
}

export function requireDb(env) {
  if (!env || !env.DB) {
    throw new HttpError(500, '数据库未绑定，请联系管理员', ErrorCode.CONFIG_ERROR);
  }
  return env.DB;
}

// 读取并校验 JSON 请求体：限制大小，且必须是对象
export async function readJsonBody(request, maxBytes) {
  const declared = parseInt(request.headers.get('content-length') || '0', 10);
  if (declared > maxBytes) {
    throw new HttpError(413, '请求体过大', ErrorCode.PAYLOAD_TOO_LARGE);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new HttpError(413, '请求体过大', ErrorCode.PAYLOAD_TOO_LARGE);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new HttpError(400, '请求参数格式错误 (必须为有效 JSON)', ErrorCode.BAD_REQUEST);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, '请求参数格式错误 (必须为 JSON 对象)', ErrorCode.BAD_REQUEST);
  }
  return parsed;
}
