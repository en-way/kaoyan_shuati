import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DB } from '../js/state/store.js';
import { KY_CONFIG, DEFAULT_BANK_ID, getBankStorageKeys } from '../js/config.js';

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); },
    keys() { return Array.from(store.keys()); }
  };
}

describe('js/state/store.js 多题库状态隔离与 v37 旧数据无损迁移', () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    DB._customStorage = mockStorage;
    DB._storageWriteBlocked = false;
    DB.currentBankId = DEFAULT_BANK_ID;
  });

  it('老版本 v37 本地进度 (quiz_user_data_2027) 应自动无损迁移到 kaoyan_progress_2027_1000', () => {
    const legacyPayload = {
      answers: {
        Q_0001: { selected: ['A'], is_correct: true, updated_at: '2026-10-15T00:00:00.000Z' }
      },
      mistakes: {
        Q_0005: { question_id: 'Q_0005', wrong_count: 2, last_selected: ['B'], mastered: false }
      }
    };
    mockStorage.setItem(KY_CONFIG.STORAGE_KEYS.USER_DATA, JSON.stringify(legacyPayload));

    const userData = DB.getUserData('2027_1000');
    assert.deepEqual(userData.answers.Q_0001.selected, ['A']);
    assert.equal(userData.mistakes.Q_0005.wrong_count, 2);

    // 验证新键已自动写入，且迁移标记已建立
    const defaultKeys = getBankStorageKeys('2027_1000');
    assert.ok(mockStorage.getItem(defaultKeys.PROGRESS));
    assert.ok(mockStorage.getItem(KY_CONFIG.STORAGE_KEYS.MIGRATED_V38));
  });

  it('多 bankId 之间进度与错题本应严格隔离，互不覆盖', () => {
    DB.saveUserData({
      answers: { Q_0001: { selected: ['A'], is_correct: true } },
      mistakes: {}
    }, '2027_1000');

    DB.saveUserData({
      answers: { Q_0001: { selected: ['D'], is_correct: false } },
      mistakes: { Q_0001: { wrong_count: 1, mastered: false } }
    }, '2028_1000');

    const data2027 = DB.getUserData('2027_1000');
    const data2028 = DB.getUserData('2028_1000');

    assert.deepEqual(data2027.answers.Q_0001.selected, ['A']);
    assert.equal(Object.keys(data2027.mistakes).length, 0);

    assert.deepEqual(data2028.answers.Q_0001.selected, ['D']);
    assert.equal(data2028.mistakes.Q_0001.wrong_count, 1);
  });

  it('损坏的 localStorage JSON 应自动隔离备份并阻止空数据写穿覆盖', () => {
    const keys = getBankStorageKeys('2027_1000');
    mockStorage.setItem(keys.PROGRESS, '{corrupted_json:');

    const fallback = DB.getUserData('2027_1000');
    assert.deepEqual(fallback, { answers: {}, mistakes: {} });
    assert.equal(DB._storageWriteBlocked, true);

    // 验证已生成 kaoyan_corrupt_bak_ 隔离备份键
    const backupKey = mockStorage.keys().find(k => k.startsWith('kaoyan_corrupt_bak_2027_1000_'));
    assert.ok(backupKey, '应自动保存损坏快照以便恢复');
    assert.equal(mockStorage.getItem(backupKey), '{corrupted_json:');

    // 写保护生效期间拒绝空写穿
    const writeRes = DB.saveUserData({ answers: {}, mistakes: {} }, '2027_1000');
    assert.equal(writeRes, false);
  });

  it('导入与导出备份 JSON: 兼容无 bankId 的旧版备份文件并默认归入 2027_1000', () => {
    // 1. 导入无 bankId 的旧版备份
    const legacyBackup = JSON.stringify({
      answers: {
        Q_0010: { selected: ['C'], is_correct: true }
      },
      mistakes: {
        Q_0012: { wrong_count: 1, last_selected: ['A'], mastered: false }
      }
    });
    const importRes = DB.importBackupPayload(legacyBackup);
    assert.equal(importRes.success, true);
    assert.equal(importRes.bankId, '2027_1000');
    assert.equal(importRes.answeredCount, 1);

    // 2. 导出新版带 bankId 的备份
    const exported = DB.exportBackupPayload('2027_1000');
    assert.equal(exported.bankId, '2027_1000');
    assert.deepEqual(exported.answers.Q_0010.selected, ['C']);

    // 3. 非法 JSON 容错拦截
    const badRes = DB.importBackupPayload('not a json');
    assert.equal(badRes.success, false);
  });
});
