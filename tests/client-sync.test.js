import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DB } from '../js/state/store.js';
import { KY_CONFIG, DEFAULT_BANK_ID, getBankStorageKeys } from '../js/config.js';
import { createAuthController } from '../js/core/sync.js';

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get length() { return store.size; },
    key(idx) { return Array.from(store.keys())[idx] ?? null; },
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); },
    keys() { return Array.from(store.keys()); }
  };
}

describe('前端云同步控制器 (cloud-sync.js + auth-ui.js) 状态机与并发安全测试', () => {
  let mockStorage;
  let origFetch;
  let origLocalStorage;
  let origDocument;
  let toasts;
  let mockApp;

  beforeEach(() => {
    mockStorage = createMockStorage();
    origFetch = globalThis.fetch;
    origLocalStorage = globalThis.localStorage;
    origDocument = globalThis.document;
    globalThis.localStorage = mockStorage;
    globalThis.document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {}
    };

    DB._customStorage = mockStorage;
    DB._storageWriteBlocked = false;
    DB.currentBankId = DEFAULT_BANK_ID;
    const sampleBank = JSON.parse(fs.readFileSync(new URL('../data/questions.sample.json', import.meta.url), 'utf8'));
    DB.questionsData = sampleBank;
    DB.questionsMap = Object.fromEntries(sampleBank.questions.map(q => [q.id, q]));

    toasts = [];
    mockApp = {
      state: { questions: [], currentIndex: 0, selectedOptions: [], examDraftAnswers: {}, mistakesList: [], overview: {} },
      showToast(msg, type) { toasts.push({ msg, type }); },
      async showConfirm() { return true; },
      loadOverview() {}
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = origLocalStorage;
    if (origDocument === undefined) delete globalThis.document;
    else globalThis.document = origDocument;
  });

  it('uploadToCloud 应携带当前/指定 bankId 并在收到 409 时先自动合并后重试携带最新版本号', async () => {
    const requests = [];
    let attempt = 0;
    globalThis.fetch = async (url, opts) => {
      requests.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
      attempt++;
      if (attempt === 1) {
        return new Response(JSON.stringify({
          success: false,
          code: 'VERSION_CONFLICT',
          version: 4,
          answers: { Q_0002: ['ABD', 1, 9000, 1] },
          mistakes: {},
          updatedAt: 9000
        }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        success: true,
        version: 5,
        answers: { Q_0001: ['A', 1, 5000, 0], Q_0002: ['ABD', 1, 9000, 1] },
        mistakes: {},
        updatedAt: 9500
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    DB.saveUserData({
      answers: { Q_0001: { selected: ['A'], is_correct: true, updated_at: new Date(5000).toISOString() } },
      mistakes: {}
    }, '2027_1000');
    DB.setCloudVersion(2, '2027_1000');

    const auth = createAuthController(() => mockApp);
    auth.token = 'jwt.valid.token';
    auth.isDirty = true;
    mockStorage.setItem(KY_CONFIG.STORAGE_KEYS.IS_DIRTY, '1');

    await auth.uploadToCloud(true, '2027_1000');

    assert.equal(requests.length, 2);
    assert.equal(requests[0].body.bankId, '2027_1000');
    assert.equal(requests[0].body.expectedVersion, 2);
    assert.equal(requests[1].body.expectedVersion, 4);
    assert.ok(requests[1].body.answers.Q_0001);
    assert.ok(requests[1].body.answers.Q_0002);
    assert.equal(DB.getCloudVersion('2027_1000'), 5);
    assert.equal(auth.isDirty, false);
  });

  it('uploadToCloud 发送 resetQids + resetAt 部分章节重置后，成功后应自动清除 PENDING_CHAPTER_RESET', async () => {
    const sentBodies = [];
    globalThis.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      sentBodies.push(body);
      return new Response(JSON.stringify({
        success: true,
        version: 3,
        answers: {},
        mistakes: {},
        updatedAt: Date.now()
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    DB.saveUserData({
      answers: { Q_0001: { selected: ['A'], is_correct: true, updated_at: '2026-11-01T00:00:00.000Z' } },
      mistakes: {}
    }, '2027_1000');
    DB.resetChapter('第一部分 马克思主义基本原理', '导论');
    assert.equal(DB.hasPendingOverwrite('2027_1000'), false);
    const pendingReset = DB.getPendingChapterReset('2027_1000');
    assert.ok(pendingReset);
    assert.equal(pendingReset.qids.length, 2);

    const auth = createAuthController(() => mockApp);
    auth.token = 'jwt.valid.token';
    auth.isDirty = true;

    await auth.uploadToCloud(true, '2027_1000');

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0].overwrite, false);
    assert.deepEqual(sentBodies[0].resetQids, ['Q_0001', 'Q_0002']);
    assert.ok(sentBodies[0].resetAt > 0);
    assert.equal(DB.getPendingChapterReset('2027_1000'), null);
  });

  it('409 重试返回 401 时必须触发 handleSessionExpired 并终止', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ code: 'VERSION_CONFLICT', version: 2, answers: {}, mistakes: {} }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ error: 'Token expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const auth = createAuthController(() => mockApp);
    auth.token = 'jwt.expiring';
    mockStorage.setItem(KY_CONFIG.STORAGE_KEYS.TOKEN, 'jwt.expiring');

    await auth.uploadToCloud(true, '2027_1000');

    assert.equal(calls, 2);
    assert.equal(auth.token, null);
    assert.equal(mockStorage.getItem(KY_CONFIG.STORAGE_KEYS.TOKEN), null);
  });

  it('syncAllDirtyBanks 仅上传有脏标记或待同步章节重置的题库', async () => {
    const uploadedBanks = [];
    globalThis.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      uploadedBanks.push(body.bankId);
      return new Response(JSON.stringify({
        success: true,
        version: 2,
        answers: body.answers || {},
        mistakes: body.mistakes || {},
        updatedAt: Date.now()
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    DB.catalog = { defaultBankId: '2027_1000', banks: [{ id: '2027_1000' }, { id: '2028_1000' }] };
    const keys2028 = getBankStorageKeys('2028_1000');
    mockStorage.setItem(keys2028.PROGRESS, JSON.stringify({ answers: { Q_0001: { selected: ['B'], is_correct: false } }, mistakes: {} }));
    mockStorage.setItem(keys2028.IS_DIRTY, '1');

    const auth = createAuthController(() => mockApp);
    auth.token = 'jwt.valid.token';
    auth.isDirty = false;

    await auth.syncAllDirtyBanks();
    assert.deepEqual(uploadedBanks, ['2028_1000']);
    assert.equal(mockStorage.getItem(keys2028.IS_DIRTY), null);
  });

  it('登录时若云端下载失败，必须完整保留用户本机做题数据不清空', async () => {
    const keys = getBankStorageKeys('2027_1000');
    DB.saveUserData({
      answers: { Q_0001: { selected: ['B'], is_correct: true, updated_at: '2026-11-10T00:00:00.000Z' } },
      mistakes: {}
    }, '2027_1000');

    let step = 0;
    globalThis.fetch = async () => {
      step++;
      if (step === 1) {
        // /api/auth/login 成功
        return new Response(JSON.stringify({
          success: true,
          token: 'new.jwt.token',
          user: { id: 'u1', username: 'test01', nickname: '测试同学' }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // /api/progress/sync 下载失败 (500)
      return new Response(JSON.stringify({ error: 'D1 temporary outage' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const auth = createAuthController(() => mockApp);
    // 提供最小表单元素 mock
    const inputValues = {
      loginUsername: { value: 'test01' },
      loginPassword: { value: 'Secret123' },
      btnLoginSubmit: { disabled: false, textContent: '立即登录并同步' },
      authNotice: { style: {} }
    };
    globalThis.document.getElementById = (id) => inputValues[id] || null;

    await auth.handleLogin({ preventDefault() {} });

    // 虽然云端拉取失败，但本地已有 Q_0001 记录绝不能被误清
    const preserved = JSON.parse(mockStorage.getItem(keys.PROGRESS));
    assert.deepEqual(preserved.answers.Q_0001.selected, ['B']);
  });
});
