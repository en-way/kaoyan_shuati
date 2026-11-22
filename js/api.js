/**
 * 前端统一网络层 (ES Module + 全局 window.KyApi 兼容)：
 * 弹性超时 + 指数退避重试 + 统一错误对象 + 多题库 bankId 透传。
 */
import { KY_CONFIG, DEFAULT_BANK_ID } from './config.js';

// 网络层异常（超时/断网），与「服务端返回了 4xx/5xx」严格区分
export class NetworkError extends Error {
  constructor(message, isTimeout) {
    super(message);
    this.name = isTimeout ? 'TimeoutError' : 'NetworkError';
    this.isTimeout = !!isTimeout;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffFor(attempt, backoffList = KY_CONFIG.SYNC.BACKOFF_MS) {
  return backoffList[Math.min(attempt - 1, backoffList.length - 1)];
}

/**
 * 带超时与退避重试的 fetch。
 * 重试条件：超时 / 网络错误 / 网关抖动 (502,503,504)。4xx 与业务错误不重试。
 */
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const maxRetries = retryOptions.maxRetries ?? KY_CONFIG.SYNC.MAX_RETRIES;
  const timeoutMs = retryOptions.timeoutMs ?? KY_CONFIG.SYNC.TIMEOUT_MS;
  const backoffList = retryOptions.backoffMs ?? KY_CONFIG.SYNC.BACKOFF_MS;
  const onRetry = retryOptions.onRetry || null;
  const fetchImpl = retryOptions.fetchImpl || globalThis.fetch;
  let attempt = 0;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const err = new Error('TimeoutError');
      err.name = 'TimeoutError';
      controller.abort(err);
    }, timeoutMs);

    try {
      const res = await fetchImpl(url, { ...options, signal: controller.signal });
      clearTimeout(timer);

      if (res.status >= 502 && res.status <= 504 && attempt < maxRetries) {
        attempt++;
        const wait = backoffFor(attempt, backoffList);
        if (onRetry) onRetry(attempt, maxRetries, wait, new Error(`HTTP ${res.status}`));
        await sleep(wait);
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = Boolean(
        err && (err.name === 'TimeoutError' || err.isTimeout || /timeout|aborted/i.test(err.message || ''))
      );
      const isNetwork = Boolean(
        err && (err.name === 'TypeError' || /fetch|network|failed|ECONN|ENOTFOUND/i.test(err.message || ''))
      );

      if ((isTimeout || isNetwork) && attempt < maxRetries) {
        attempt++;
        const wait = backoffFor(attempt, backoffList);
        if (onRetry) onRetry(attempt, maxRetries, wait, err);
        await sleep(wait);
        continue;
      }
      throw new NetworkError(err && err.message ? err.message : '网络异常', isTimeout);
    }
  }
}

/**
 * 统一解析响应为 { ok, status, code, error, data }。
 * 服务端非 JSON（如网关 HTML 错误页）也不会抛 SyntaxError。
 */
export async function parseResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  const ok = res.ok && data && data.success !== false;
  return {
    ok: !!ok,
    status: res.status,
    code: (data && data.code) || null,
    error: (data && data.error) || (ok ? null : `请求失败 (HTTP ${res.status})`),
    data: data || {}
  };
}

/**
 * 拉取指定 bankId 的云端做题进度
 */
export async function fetchCloudProgressApi({
  token,
  bankId = DEFAULT_BANK_ID,
  clientTime = 0,
  baseUrl = '',
  retryOptions = {}
} = {}) {
  const qs = new URLSearchParams({
    bankId: bankId || DEFAULT_BANK_ID,
    clientTime: String(clientTime || 0)
  });
  const res = await fetchWithRetry(`${baseUrl}/api/progress/sync?${qs.toString()}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }, retryOptions);
  return parseResponse(res);
}

/**
 * 推送/同步指定 bankId 的做题进度到云端
 */
export async function pushCloudProgressApi({
  token,
  bankId = DEFAULT_BANK_ID,
  answers = {},
  mistakes = {},
  expectedVersion = undefined,
  overwrite = false,
  baseUrl = '',
  retryOptions = {}
} = {}) {
  const payload = {
    bankId: bankId || DEFAULT_BANK_ID,
    answers,
    mistakes,
    overwrite: !!overwrite
  };
  if (expectedVersion !== undefined && expectedVersion !== null) {
    payload.expectedVersion = expectedVersion;
  }
  const res = await fetchWithRetry(`${baseUrl}/api/progress/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  }, retryOptions);
  return parseResponse(res);
}

export const KyApi = Object.freeze({
  NetworkError,
  fetchWithRetry,
  parseResponse,
  fetchCloudProgressApi,
  pushCloudProgressApi
});

if (typeof globalThis !== 'undefined') {
  globalThis.KyApi = KyApi;
}
