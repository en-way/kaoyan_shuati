/**
 * 前端统一网络层：弹性超时 + 指数退避重试 + 统一错误对象。
 * 依赖 js/config.js（必须先加载）。
 */
(function (global) {
  'use strict';

  const CFG = global.KY_CONFIG;

  // 网络层异常（超时/断网），与「服务端返回了 4xx/5xx」严格区分
  class NetworkError extends Error {
    constructor(message, isTimeout) {
      super(message);
      this.name = isTimeout ? 'TimeoutError' : 'NetworkError';
      this.isTimeout = !!isTimeout;
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function backoffFor(attempt) {
    const list = CFG.SYNC.BACKOFF_MS;
    return list[Math.min(attempt - 1, list.length - 1)];
  }

  /**
   * 带超时与退避重试的 fetch。
   * 重试条件：超时 / 网络错误 / 网关抖动 (502,503,504)。4xx 与业务错误不重试。
   * 与原 App.auth.fetchWithRetry 行为一致，签名保持兼容。
   */
  async function fetchWithRetry(url, options = {}, retryOptions = {}) {
    const maxRetries = retryOptions.maxRetries ?? CFG.SYNC.MAX_RETRIES;
    const timeoutMs = retryOptions.timeoutMs ?? CFG.SYNC.TIMEOUT_MS;
    const onRetry = retryOptions.onRetry || null;
    let attempt = 0;

    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort(new DOMException('TimeoutError', 'TimeoutError'));
      }, timeoutMs);

      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);

        if (res.status >= 502 && res.status <= 504 && attempt < maxRetries) {
          attempt++;
          const wait = backoffFor(attempt);
          if (onRetry) onRetry(attempt, maxRetries, wait, new Error(`HTTP ${res.status}`));
          await sleep(wait);
          continue;
        }
        return res;
      } catch (err) {
        clearTimeout(timer);
        const isTimeout = err && (err.name === 'TimeoutError' || /timeout/i.test(err.message || ''));
        const isNetwork = err && (err.name === 'TypeError' || /fetch|network|failed/i.test(err.message || ''));

        if ((isTimeout || isNetwork) && attempt < maxRetries) {
          attempt++;
          const wait = backoffFor(attempt);
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
  async function parseResponse(res) {
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

  global.KyApi = Object.freeze({ NetworkError, fetchWithRetry, parseResponse });
})(window);
