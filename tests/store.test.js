import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

  it('submitExam 考场草稿隔离：仅对本次模考作答判分，不误计历史日常记录也不漏改未答历史题', () => {
    const sampleBank = JSON.parse(fs.readFileSync(new URL('../data/questions.sample.json', import.meta.url), 'utf8'));
    const prevQuestionsData = DB.questionsData;
    const prevQuestionsMap = DB.questionsMap;
    try {
      DB.questionsData = sampleBank;
      DB.questionsMap = Object.fromEntries(sampleBank.questions.map(q => [q.id, q]));

      // 考前：Q_0001 在即做即判模式已做错（选 A）
      DB.saveUserData({
        answers: { Q_0001: { selected: ['A'], is_correct: false, updated_at: '2026-11-01T00:00:00.000Z' } },
        mistakes: { Q_0001: { question_id: 'Q_0001', wrong_count: 1, last_selected: ['A'], mastered: false } }
      }, '2027_1000');

      // 本次模考仅作答 Q_0002（多选正确 ABD），刻意留空 Q_0001
      const examDraft = {
        Q_0002: { selected: ['A', 'B', 'D'], time_spent: 18, is_flagged: false }
      };
      const report = DB.submitExam('第一部分 马克思主义基本原理', '导论', examDraft);

      // 成绩单：仅 Q_0002 计分 (2/3 分)，Q_0001 计为未作答，不得误判考前错选 A
      assert.equal(report.total, 2);
      assert.equal(report.correct_count, 1);
      assert.equal(report.wrong_count, 0);
      assert.equal(report.unanswered_count, 1);
      assert.equal(report.earned_points, 2);
      assert.equal(report.results.find(r => r.id === 'Q_0001').user_ans, '未作答');

      // 本地存档：原 Q_0001 历史作答与错题完整保留，Q_0002 写入存档
      const saved = DB.getUserData('2027_1000');
      assert.deepEqual(saved.answers.Q_0001.selected, ['A']);
      assert.equal(saved.answers.Q_0001.is_correct, false);
      assert.equal(saved.mistakes.Q_0001.mastered, false);
      assert.deepEqual(saved.answers.Q_0002.selected, ['A', 'B', 'D']);
      assert.equal(saved.answers.Q_0002.is_correct, true);
    } finally {
      DB.questionsData = prevQuestionsData;
      DB.questionsMap = prevQuestionsMap;
    }
  });

  it('resetChapter 使用部分章节重置队列 (PENDING_CHAPTER_RESET) 且不设置全库 overwrite；saveAnswer 攻克错题同步更新 last_wrong_time；QuotaExceeded 返回 saveOk=false', () => {
    const sampleBank = JSON.parse(fs.readFileSync(new URL('../data/questions.sample.json', import.meta.url), 'utf8'));
    const prevQuestionsData = DB.questionsData;
    const prevQuestionsMap = DB.questionsMap;
    try {
      DB.questionsData = sampleBank;
      DB.questionsMap = Object.fromEntries(sampleBank.questions.map(q => [q.id, q]));

      // 1. Q_0001 标准答案为 B：先错选 A，回退历史时间后重刷选对 B，mastered 更新且 last_wrong_time 同步推进
      DB.saveAnswer('Q_0001', ['A'], 5, false, true);
      const seeded = DB.getUserData('2027_1000');
      seeded.mistakes.Q_0001.last_wrong_time = '2026-01-01T00:00:00.000Z';
      DB.saveUserData(seeded, '2027_1000');
      DB.saveAnswer('Q_0001', ['B'], 4, false, true);
      const afterMaster = DB.getUserData('2027_1000').mistakes.Q_0001;
      assert.equal(afterMaster.mastered, true);
      assert.ok(afterMaster.last_wrong_time > '2026-01-01T00:00:00.000Z');

      // 2. resetChapter 仅写 PENDING_CHAPTER_RESET，不置 PENDING_OVERWRITE
      DB.resetChapter('第一部分 马克思主义基本原理', '导论');
      assert.equal(DB.hasPendingOverwrite('2027_1000'), false);
      const resetMeta = DB.getPendingChapterReset('2027_1000');
      assert.ok(resetMeta);
      assert.deepEqual(resetMeta.qids, ['Q_0001', 'Q_0002']);

      // 3. QuotaExceededError 写入失败时 wasLastSaveOk() 为 false
      DB._customStorage = {
        getItem: () => null,
        setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
        removeItem: () => {}
      };
      const savedOk = DB.saveUserData({ answers: {}, mistakes: {} }, '2027_1000');
      assert.equal(savedOk, false);
      assert.equal(DB.wasLastSaveOk(), false);
    } finally {
      DB.questionsData = prevQuestionsData;
      DB.questionsMap = prevQuestionsMap;
    }
  });
});
