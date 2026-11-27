/**
 * 多题库状态管理与本地持久化层 (js/state/store.js)
 * - 支持按 bankId 隔离存储 (`kaoyan_progress_<bankId>`)
 * - 100% 自动无损迁移老版本 `quiz_user_data_2027` 进度数据，并在默认题库下保持双向镜像写入
 * - 支持损坏 JSON 容灾隔离备份与旧版无 bankId 备份文件的导入兼容
 */
import {
  KY_CONFIG,
  DEFAULT_BANK_ID,
  ASSET_VERSION,
  getBankStorageKeys
} from '../config.js';
import {
  evaluateAnswer,
  toCompactPayload,
  mergeFromCompactPayload,
  snapshotFromCompactPayload,
  computeOverview,
  filterQuestions,
  computeMistakesList
} from '../core/quiz.js';
import { gradeChapterExam } from '../core/exam.js';

export const DB = {
  catalog: null,
  currentBankId: DEFAULT_BANK_ID,
  questionsData: null,
  questionsMap: {},
  _storageWriteBlocked: false,

  /**
   * 获取当前使用的 storage 对象（支持在 Node.js 测试中注入 mockStorage）
   */
  _getStorage() {
    return this._customStorage || globalThis.localStorage;
  },

  /**
   * 获取当前激活题库的存储键集
   */
  getActiveKeys(bankId = this.currentBankId) {
    return getBankStorageKeys(bankId || DEFAULT_BANK_ID);
  },

  /**
   * 一次性无损迁移老版本 v37 本地存档 (`quiz_user_data_2027` -> `kaoyan_progress_2027_1000`)
   */
  migrateLegacyStorageIfNeeded() {
    const storage = this._getStorage();
    if (!storage) return false;

    const defaultKeys = getBankStorageKeys(DEFAULT_BANK_ID);
    const newRaw = storage.getItem(defaultKeys.PROGRESS);
    const legacyRaw = storage.getItem(KY_CONFIG.STORAGE_KEYS.USER_DATA);

    if (!newRaw && legacyRaw) {
      try {
        const parsed = JSON.parse(legacyRaw);
        if (parsed && typeof parsed === 'object') {
          if (!parsed.answers) parsed.answers = {};
          if (!parsed.mistakes) parsed.mistakes = {};
          storage.setItem(defaultKeys.PROGRESS, JSON.stringify(parsed));
          storage.setItem(KY_CONFIG.STORAGE_KEYS.MIGRATED_V38, String(Date.now()));
          return true;
        }
      } catch (e) {
        // 即使旧数据损坏也绝不直接抹除，交由 getUserData 的容灾隔离处理
      }
    }
    return false;
  },

  /**
   * 加载题库目录清单 data/catalog.json（若失败则回退到内置默认 2027_1000 清单）
   */
  async loadCatalog(fetchImpl = globalThis.fetch) {
    const defaultCatalog = {
      defaultBankId: DEFAULT_BANK_ID,
      banks: [
        {
          id: DEFAULT_BANK_ID,
          title: '2027 肖秀荣考研政治 1000 题',
          shortTitle: '27版肖1000题',
          year: 2027,
          questionCount: 1148,
          version: ASSET_VERSION,
          file: 'data/banks/2027_1000.json',
          fallbackFile: 'data/questions.json',
          description: '2027 考研政治 1000 题全量官方解析版'
        }
      ]
    };

    if (typeof fetchImpl !== 'function') {
      this.catalog = defaultCatalog;
      return this.catalog;
    }

    try {
      const res = await fetchImpl(`data/catalog.json?v=${ASSET_VERSION}`);
      if (res && res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.banks) && data.banks.length > 0) {
          this.catalog = data;
          return this.catalog;
        }
      }
    } catch (_) {}

    this.catalog = defaultCatalog;
    return this.catalog;
  },

  /**
   * 获取指定 bankId 的题库元数据
   */
  getBankMeta(bankId = this.currentBankId) {
    const list = (this.catalog && this.catalog.banks) || [];
    return list.find(b => b.id === bankId) || list[0] || {
      id: DEFAULT_BANK_ID,
      title: '2027 肖秀荣考研政治 1000 题',
      shortTitle: '27版肖1000题',
      year: 2027,
      version: ASSET_VERSION,
      file: 'data/banks/2027_1000.json',
      fallbackFile: 'data/questions.json'
    };
  },

  /**
   * 初始化题库与本地迁移
   */
  async init(targetBankId = null, fetchImpl = globalThis.fetch) {
    this.migrateLegacyStorageIfNeeded();

    if (!this.catalog) {
      await this.loadCatalog(fetchImpl);
    }

    const storage = this._getStorage();
    const savedBankId = storage ? storage.getItem(KY_CONFIG.STORAGE_KEYS.CURRENT_BANK_ID) : null;
    const desiredBankId = targetBankId || savedBankId || (this.catalog && this.catalog.defaultBankId) || DEFAULT_BANK_ID;

    // 校验 desiredBankId 是否在 catalog 中存在
    const existsInCatalog = this.catalog && Array.isArray(this.catalog.banks)
      && this.catalog.banks.some(b => b.id === desiredBankId);
    const nextBankId = existsInCatalog ? desiredBankId : DEFAULT_BANK_ID;

    if (this.questionsData && this.currentBankId === nextBankId) {
      return;
    }

    await this.loadBankQuestions(nextBankId, fetchImpl);
  },

  /**
   * 加载指定题库 JSON 并构建 questionsMap
   */
  async loadBankQuestions(bankId = DEFAULT_BANK_ID, fetchImpl = globalThis.fetch) {
    const meta = this.getBankMeta(bankId);
    const ver = meta.version || ASSET_VERSION;
    const candidateUrls = [
      `${meta.file}?v=${ver}`,
      `./${meta.file}?v=${ver}`
    ];
    if (meta.fallbackFile) {
      candidateUrls.push(`${meta.fallbackFile}?v=${ver}`);
      candidateUrls.push(`./${meta.fallbackFile}?v=${ver}`);
    }

    let loadedData = null;
    let lastErr = null;
    for (const url of candidateUrls) {
      try {
        const res = await fetchImpl(url);
        if (res && res.ok) {
          loadedData = await res.json();
          break;
        }
      } catch (e) {
        lastErr = e;
      }
    }

    if (!loadedData || !Array.isArray(loadedData.questions)) {
      console.error('Failed to load question bank:', bankId, lastErr);
      if (globalThis.App && typeof globalThis.App.showToast === 'function') {
        globalThis.App.showToast(`未能加载题库文件 (${meta.file})，请检查网络或部署路径！`, 'error', 4500);
      }
      return false;
    }

    this.currentBankId = meta.id || bankId;
    this.questionsData = loadedData;
    this.questionsMap = {};
    for (const q of loadedData.questions) {
      this.questionsMap[q.id] = q;
    }

    const storage = this._getStorage();
    if (storage) {
      try {
        storage.setItem(KY_CONFIG.STORAGE_KEYS.CURRENT_BANK_ID, this.currentBankId);
      } catch (_) {}
    }
    return true;
  },

  /**
   * 切换当前题库
   */
  async switchBank(bankId, fetchImpl = globalThis.fetch) {
    if (!bankId || (bankId === this.currentBankId && this.questionsData)) {
      return true;
    }
    this._storageWriteBlocked = false;
    return this.loadBankQuestions(bankId, fetchImpl);
  },

  /**
   * 读取指定题库（默认当前题库）的用户做题与错题记录
   */
  getUserData(bankId = this.currentBankId) {
    const storage = this._getStorage();
    if (!storage) return { answers: {}, mistakes: {} };

    this.migrateLegacyStorageIfNeeded();
    const keys = this.getActiveKeys(bankId);

    const raw = storage.getItem(keys.PROGRESS)
      || (keys.LEGACY_PROGRESS ? storage.getItem(keys.LEGACY_PROGRESS) : null);

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (!parsed.answers || typeof parsed.answers !== 'object') parsed.answers = {};
          if (!parsed.mistakes || typeof parsed.mistakes !== 'object') parsed.mistakes = {};
          this._storageWriteBlocked = false;
          return parsed;
        }
      } catch (e) {
        console.error('Critical: LocalStorage corrupted, isolating bad data:', e);
        try {
          storage.setItem(`kaoyan_corrupt_bak_${keys.bankId}_${Date.now()}`, raw);
          this._storageWriteBlocked = true;
        } catch (_) {}
      }
    }
    return { answers: {}, mistakes: {} };
  },

  /**
   * 保存指定题库（默认当前题库）的用户做题与错题记录
   */
  saveUserData(data, bankId = this.currentBankId) {
    if (this._storageWriteBlocked) {
      console.warn('Storage write blocked due to corrupted data isolation protection.');
      return false;
    }
    const storage = this._getStorage();
    if (!storage) return false;

    const keys = this.getActiveKeys(bankId);
    const normalized = {
      answers: (data && data.answers && typeof data.answers === 'object') ? data.answers : {},
      mistakes: (data && data.mistakes && typeof data.mistakes === 'object') ? data.mistakes : {}
    };
    const serialized = JSON.stringify(normalized);

    try {
      storage.setItem(keys.PROGRESS, serialized);
      // 当操作默认题库 2027_1000 时，同步更新旧键 quiz_user_data_2027 镜像，确保 100% 双向兼容
      if (keys.LEGACY_PROGRESS) {
        storage.setItem(keys.LEGACY_PROGRESS, serialized);
      }
      if (globalThis.App && globalThis.App.auth && typeof globalThis.App.auth.markDirty === 'function') {
        globalThis.App.auth.markDirty(keys.bankId);
      }
      return true;
    } catch (e) {
      console.error('Failed to save user data to localStorage:', e);
      if (e && e.name === 'QuotaExceededError' && globalThis.App && typeof globalThis.App.showToast === 'function') {
        globalThis.App.showToast('⚠️ 本地存储空间已满，无法保存新答题记录，请清理缓存或上传云端', 'warning', 4500);
      }
      return false;
    }
  },

  /**
   * 记录/读取当前题库是否需要在下次同步时执行 overwrite 快照覆盖（用于重置章节或清空本地后）
   */
  setPendingOverwrite(flag, bankId = this.currentBankId) {
    const storage = this._getStorage();
    if (!storage) return;
    const keys = this.getActiveKeys(bankId);
    if (flag) {
      storage.setItem(keys.PENDING_OVERWRITE, 'true');
    } else {
      storage.removeItem(keys.PENDING_OVERWRITE);
    }
  },

  hasPendingOverwrite(bankId = this.currentBankId) {
    const storage = this._getStorage();
    if (!storage) return false;
    const keys = this.getActiveKeys(bankId);
    return storage.getItem(keys.PENDING_OVERWRITE) === 'true';
  },

  /**
   * 记录/读取云端乐观锁版本号 version
   */
  getCloudVersion(bankId = this.currentBankId) {
    const storage = this._getStorage();
    if (!storage) return null;
    const keys = this.getActiveKeys(bankId);
    const v = parseInt(storage.getItem(keys.CLOUD_VERSION) || '', 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  },

  setCloudVersion(version, bankId = this.currentBankId) {
    const storage = this._getStorage();
    if (!storage) return;
    const keys = this.getActiveKeys(bankId);
    if (Number.isFinite(version) && version > 0) {
      storage.setItem(keys.CLOUD_VERSION, String(version));
    }
  },

  toCompact(bankId = this.currentBankId) {
    return toCompactPayload(this.getUserData(bankId));
  },

  mergeFromCompact(cloudData, bankId = this.currentBankId) {
    const current = this.getUserData(bankId);
    const merged = mergeFromCompactPayload(current, cloudData);
    this._storageWriteBlocked = false;
    const storage = this._getStorage();
    const keys = this.getActiveKeys(bankId);
    if (storage) {
      const s = JSON.stringify(merged);
      storage.setItem(keys.PROGRESS, s);
      if (keys.LEGACY_PROGRESS) storage.setItem(keys.LEGACY_PROGRESS, s);
    }
    if (cloudData && Number.isFinite(cloudData.version)) {
      this.setCloudVersion(cloudData.version, bankId);
    }
    return merged;
  },

  setFromCloud(cloudData, bankId = this.currentBankId) {
    const newUserData = snapshotFromCompactPayload(cloudData);
    this._storageWriteBlocked = false;
    const storage = this._getStorage();
    const keys = this.getActiveKeys(bankId);
    if (storage) {
      const s = JSON.stringify(newUserData);
      storage.setItem(keys.PROGRESS, s);
      if (keys.LEGACY_PROGRESS) storage.setItem(keys.LEGACY_PROGRESS, s);
    }
    if (cloudData && Number.isFinite(cloudData.version)) {
      this.setCloudVersion(cloudData.version, bankId);
    }
    return newUserData;
  },

  getOverview() {
    return computeOverview(this.questionsData, this.getUserData());
  },

  getQuestions(part, chapter, qType, mode) {
    return filterQuestions(this.questionsData, this.getUserData(), { part, chapter, qType, mode });
  },

  saveAnswer(qid, selected, timeSpent, isFlagged, evalNow = true) {
    const q = this.questionsMap[qid];
    if (!q) return { success: false, error: 'Question not found' };

    const userData = this.getUserData();
    const { isCorrect, stdAns } = evaluateAnswer(q, selected, evalNow);
    const userStr = Array.isArray(selected) ? selected.slice().sort().join('') : '';
    const nowIso = new Date().toISOString();

    if (!userData.answers[qid]) {
      userData.answers[qid] = {};
    }

    const rec = userData.answers[qid];
    rec.selected = selected;
    rec.time_spent = timeSpent;
    rec.is_flagged = isFlagged;
    rec.is_correct = isCorrect;
    rec.updated_at = nowIso;

    if (evalNow && userStr) {
      if (!isCorrect) {
        if (!userData.mistakes[qid]) {
          userData.mistakes[qid] = { question_id: qid, wrong_count: 0 };
        }
        userData.mistakes[qid].wrong_count = (userData.mistakes[qid].wrong_count || 0) + 1;
        userData.mistakes[qid].last_selected = selected;
        userData.mistakes[qid].standard_answer = stdAns;
        userData.mistakes[qid].mastered = false;
        userData.mistakes[qid].last_wrong_time = nowIso;
      } else if (isCorrect && userData.mistakes[qid]) {
        userData.mistakes[qid].mastered = true;
      }
    }

    this.saveUserData(userData);

    return {
      success: true,
      question_id: qid,
      is_correct: isCorrect,
      standard_answer: stdAns,
      source: q.source || '',
      analysis: q.analysis || '',
      tips: q.tips || '',
      tag: q.tag || ''
    };
  },

  toggleFlag(qid) {
    const userData = this.getUserData();
    const now = new Date().toISOString();
    if (!userData.answers[qid]) {
      userData.answers[qid] = { selected: [], time_spent: 0, is_flagged: true, updated_at: now };
    } else {
      userData.answers[qid].is_flagged = !userData.answers[qid].is_flagged;
      userData.answers[qid].updated_at = now;
    }
    this.saveUserData(userData);
    return userData.answers[qid].is_flagged;
  },

  submitExam(part, chapter, examDraftAnswers = null) {
    const userData = this.getUserData();
    if (!examDraftAnswers || typeof examDraftAnswers !== 'object') {
      const report = gradeChapterExam(this.questionsData, userData, part, chapter);
      this.saveUserData(userData);
      return report;
    }

    // 考场草稿隔离判分：仅计入本次模考真实作答过的题目，绝不误判历史日常记录
    const isolatedSession = { answers: {}, mistakes: {} };
    for (const [qid, draft] of Object.entries(examDraftAnswers)) {
      if (draft && Array.isArray(draft.selected) && draft.selected.length > 0) {
        isolatedSession.answers[qid] = {
          selected: [...draft.selected],
          time_spent: Number.isFinite(draft.time_spent) ? draft.time_spent : 0,
          is_flagged: Boolean(draft.is_flagged)
        };
      }
    }

    const report = gradeChapterExam(this.questionsData, isolatedSession, part, chapter);

    // 交卷后将本次有效作答与错题结果批量合并回本地持久化档案
    for (const [qid, gradedAns] of Object.entries(isolatedSession.answers)) {
      userData.answers[qid] = { ...(userData.answers[qid] || {}), ...gradedAns };
    }
    for (const [qid, gradedMis] of Object.entries(isolatedSession.mistakes)) {
      const prev = userData.mistakes[qid];
      userData.mistakes[qid] = {
        question_id: qid,
        wrong_count: (prev ? (prev.wrong_count || 0) : 0) + (gradedMis.wrong_count || 1),
        last_selected: gradedMis.last_selected,
        standard_answer: gradedMis.standard_answer,
        mastered: false,
        last_wrong_time: gradedMis.last_wrong_time
      };
    }
    for (const r of report.results) {
      if (r.is_correct && userData.mistakes[r.id]) {
        userData.mistakes[r.id].mastered = true;
      }
    }

    this.saveUserData(userData);
    return report;
  },

  resetChapter(part, chapter) {
    const userData = this.getUserData();
    const allQuestions = (this.questionsData && this.questionsData.questions) || [];
    const chQIds = allQuestions
      .filter(q => q.part === part && q.chapter === chapter)
      .map(q => q.id);

    for (const qid of chQIds) {
      if (userData.answers[qid]) {
        delete userData.answers[qid];
      }
      if (userData.mistakes && userData.mistakes[qid]) {
        delete userData.mistakes[qid];
      }
    }
    this.setPendingOverwrite(true);
    this.saveUserData(userData);
    return { success: true, cleared_count: chQIds.length };
  },

  getMistakes(part, chapter) {
    return computeMistakesList(this.questionsMap, this.getUserData(), { part, chapter });
  },

  mistakeAction(qid, action) {
    const userData = this.getUserData();
    if (userData.mistakes && userData.mistakes[qid]) {
      const nowIso = new Date().toISOString();
      if (action === 'remove' || action === 'master') {
        userData.mistakes[qid].mastered = true;
        userData.mistakes[qid].last_wrong_time = nowIso;
      } else if (action === 'unmaster') {
        userData.mistakes[qid].mastered = false;
        userData.mistakes[qid].last_wrong_time = nowIso;
      }
      this.saveUserData(userData);
      return { success: true };
    }
    return { success: false, error: 'Not found' };
  },

  /**
   * 导出当前题库进度为可备份对象（带 bankId 与版本标识）
   */
  exportBackupPayload(bankId = this.currentBankId) {
    const userData = this.getUserData(bankId);
    return {
      schemaVersion: 2,
      bankId: bankId || DEFAULT_BANK_ID,
      exportedAt: new Date().toISOString(),
      answers: userData.answers || {},
      mistakes: userData.mistakes || {}
    };
  },

  /**
   * 导入本地备份 JSON（兼容旧版无 bankId 备份文件，默认归入 '2027_1000'）
   */
  importBackupPayload(rawOrObj, fallbackBankId = DEFAULT_BANK_ID) {
    let parsed = rawOrObj;
    if (typeof rawOrObj === 'string') {
      try {
        parsed = JSON.parse(rawOrObj);
      } catch (e) {
        return { success: false, error: '备份文件不是合法的 JSON 格式' };
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { success: false, error: '备份数据结构无效' };
    }

    const targetBankId = (typeof parsed.bankId === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(parsed.bankId))
      ? parsed.bankId
      : (fallbackBankId || DEFAULT_BANK_ID);

    // 兼容紧凑格式与完整格式
    const answers = parsed.answers && typeof parsed.answers === 'object' && !Array.isArray(parsed.answers)
      ? parsed.answers
      : null;
    const mistakes = parsed.mistakes && typeof parsed.mistakes === 'object' && !Array.isArray(parsed.mistakes)
      ? parsed.mistakes
      : {};

    if (!answers) {
      return { success: false, error: '备份文件缺少有效的 answers 字段' };
    }

    // 检查第一项是否为紧凑数组
    const firstVal = Object.values(answers)[0];
    let finalUserData;
    if (Array.isArray(firstVal)) {
      finalUserData = snapshotFromCompactPayload({ answers, mistakes });
    } else {
      finalUserData = { answers, mistakes };
    }

    this._storageWriteBlocked = false;
    this.saveUserData(finalUserData, targetBankId);
    return {
      success: true,
      bankId: targetBankId,
      answeredCount: Object.keys(finalUserData.answers).length,
      mistakesCount: Object.keys(finalUserData.mistakes).length
    };
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.DB = DB;
}
