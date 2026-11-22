import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry, parseResponse, NetworkError } from '../js/api.js';

describe('js/api.js 网络重试、4xx 快速失败与超时控制', () => {
  it('对 502 / 503 / 504 网关错误应按指数退避自动重试直至成功', async () => {
    let calls = 0;
    const retriesObserved = [];
    const mockFetch = async () => {
      calls++;
      if (calls === 1) return new Response('Bad Gateway', { status: 502 });
      if (calls === 2) return new Response('Service Unavailable', { status: 503 });
      return new Response(JSON.stringify({ success: true, version: 3 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const res = await fetchWithRetry('https://kaoyan.test/api/progress/sync', {}, {
      maxRetries: 2,
      timeoutMs: 1000,
      backoffMs: [5, 10],
      fetchImpl: mockFetch,
      onRetry: (attempt) => retriesObserved.push(attempt)
    });

    assert.equal(calls, 3);
    assert.deepEqual(retriesObserved, [1, 2]);
    const parsed = await parseResponse(res);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.version, 3);
  });

  it('对 4xx 业务错误 (400 / 401 / 404 / 409) 绝不重试，立即返回响应', async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      return new Response(JSON.stringify({ success: false, code: 'VERSION_CONFLICT', error: '冲突' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const res = await fetchWithRetry('https://kaoyan.test/api/progress/sync', {}, {
      maxRetries: 2,
      timeoutMs: 1000,
      backoffMs: [5, 10],
      fetchImpl: mockFetch
    });

    assert.equal(calls, 1);
    const parsed = await parseResponse(res);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.status, 409);
    assert.equal(parsed.code, 'VERSION_CONFLICT');
  });

  it('请求超时时应中断并抛出 NetworkError (isTimeout = true, name = TimeoutError)', async () => {
    let calls = 0;
    const slowFetch = async (_url, { signal }) => {
      calls++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('late')), 500);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason || new DOMException('Aborted', 'TimeoutError'));
          });
        }
      });
    };

    await assert.rejects(
      () => fetchWithRetry('https://kaoyan.test/api/progress/sync', {}, {
        maxRetries: 1,
        timeoutMs: 20,
        backoffMs: [5],
        fetchImpl: slowFetch
      }),
      (err) => {
        assert.ok(err instanceof NetworkError);
        assert.equal(err.isTimeout, true);
        assert.equal(err.name, 'TimeoutError');
        return true;
      }
    );
    assert.equal(calls, 2); // 初始 1 次 + 重试 1 次
  });
});
