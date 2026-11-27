/**
 * 纯刷题与判题业务引擎 (js/core/quiz.js)
 * 零 DOM 依赖、零全局状态耦合，所有函数均可直接在 Node.js (node:test) 中进行单元测试。
 */

const FORBIDDEN_PROTO_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toJSON'
]);

export function isSafeQid(qid) {
  return typeof qid === 'string' && qid.length > 0 && qid.length <= 64 && !FORBIDDEN_PROTO_KEYS.has(qid);
}

/**
 * 规范化选项数组或字符串为按字母排序的大写字符串，如 ['C', 'A'] -> 'AC'
 */
export function normalizeSelection(selected) {
  if (!selected) return '';
  const arr = Array.isArray(selected)
    ? selected
    : (typeof selected === 'string' ? selected.split('') : []);
  return Array.from(new Set(
    arr
      .map(s => String(s || '').trim().toUpperCase())
      .filter(s => /^[A-Z]$/.test(s))
  )).sort().join('');
}

/**
 * 单选/多选判题纯函数
 * @param {object} question 题目对象（含 answer 字段）
 * @param {string[]|string} selected 用户所选选项
 * @param {boolean} evalNow 是否立即判分
 * @returns {{ userStr: string, stdAns: string, isCorrect: boolean|null }}
 */
export function evaluateAnswer(question, selected, evalNow = true) {
  const userStr = normalizeSelection(selected);
  const stdAns = normalizeSelection(question && question.answer ? question.answer : '');
  const isCorrect = (evalNow && userStr.length > 0 && stdAns.length > 0)
    ? (userStr === stdAns)
    : null;
  return { userStr, stdAns, isCorrect };
}

/**
 * 将单条本地作答记录编码为紧凑数组 [choice, isCorrect (-1|0|1), time (ms), isFlagged (1|0)]
 */
export function encodeCompactAnswer(rec, fallbackTime = Date.now()) {
  if (!rec) return null;
  if (Array.isArray(rec)) {
    const choice = normalizeSelection(rec[0]);
    const isCorr = rec[1] === 1 ? 1 : (rec[1] === 0 ? 0 : -1);
    const t = Number.isFinite(rec[2]) ? rec[2] : fallbackTime;
    const isFlagged = rec[3] ? 1 : 0;
    return [choice, isCorr, t, isFlagged];
  }
  const selStr = normalizeSelection(rec.selected !== undefined ? rec.selected : rec.choice);
  const isCorr = rec.is_correct === true ? 1 : (rec.is_correct === false ? 0 : -1);
  const parsedTime = rec.updated_at ? Date.parse(rec.updated_at) : (Number.isFinite(rec.time) ? rec.time : NaN);
  const t = Number.isFinite(parsedTime) ? parsedTime : fallbackTime;
  const isFlagged = (rec.is_flagged || rec.flagged) ? 1 : 0;
  return [selStr, isCorr, t, isFlagged];
}

/**
 * 将紧凑数组 [choice, isCorrect, time, isFlagged] 解码为本地作答记录对象
 */
export function decodeCompactAnswer(cloudArr, prevLocalRec = null) {
  if (!cloudArr) return null;
  const selStr = Array.isArray(cloudArr)
    ? normalizeSelection(cloudArr[0])
    : normalizeSelection(cloudArr.choice !== undefined ? cloudArr.choice : cloudArr.selected);
  const isCorrRaw = Array.isArray(cloudArr)
    ? cloudArr[1]
    : (cloudArr.is_correct !== undefined ? cloudArr.is_correct : cloudArr.correct);
  const isCorr = (isCorrRaw === 1 || isCorrRaw === true)
    ? true
    : ((isCorrRaw === 0 || isCorrRaw === false) ? false : null);
  const cloudTime = Array.isArray(cloudArr)
    ? (Number.isFinite(cloudArr[2]) ? cloudArr[2] : 0)
    : (Number.isFinite(cloudArr.time) ? cloudArr.time : (Date.parse(cloudArr.updated_at) || 0));
  const isFlagged = Array.isArray(cloudArr)
    ? Boolean(cloudArr[3])
    : Boolean(cloudArr.is_flagged || cloudArr.flagged);

  return {
    selected: selStr ? selStr.split('') : [],
    is_correct: isCorr,
    is_flagged: isFlagged,
    time_spent: prevLocalRec && Number.isFinite(prevLocalRec.time_spent) ? prevLocalRec.time_spent : 0,
    updated_at: new Date(cloudTime || Date.now()).toISOString()
  };
}

/**
 * 将单条本地错题记录编码为紧凑数组 [wrongCount, lastChoice, time (ms), mastered (1|0)]
 */
export function encodeCompactMistake(rec, fallbackTime = Date.now()) {
  if (!rec) return null;
  if (Array.isArray(rec)) {
    return [
      Number.isFinite(rec[0]) && rec[0] > 0 ? rec[0] : 1,
      normalizeSelection(rec[1]),
      Number.isFinite(rec[2]) ? rec[2] : fallbackTime,
      rec[3] ? 1 : 0
    ];
  }
  const lastSelStr = normalizeSelection(rec.last_selected !== undefined ? rec.last_selected : rec.lastChoice);
  const parsedTime = rec.last_wrong_time ? Date.parse(rec.last_wrong_time) : (Number.isFinite(rec.time) ? rec.time : NaN);
  const t = Number.isFinite(parsedTime) ? parsedTime : fallbackTime;
  const count = Number.isFinite(rec.wrong_count) && rec.wrong_count > 0 ? rec.wrong_count : 1;
  return [count, lastSelStr, t, rec.mastered ? 1 : 0];
}

/**
 * 将紧凑错题数组解码为本地错题对象
 */
export function decodeCompactMistake(cloudArr, qid) {
  if (!cloudArr) return null;
  const wrongCnt = Array.isArray(cloudArr)
    ? (Number.isFinite(cloudArr[0]) ? cloudArr[0] : 1)
    : (cloudArr.count || cloudArr.wrong_count || 1);
  const lastSelStr = Array.isArray(cloudArr)
    ? normalizeSelection(cloudArr[1])
    : normalizeSelection(cloudArr.lastChoice !== undefined ? cloudArr.lastChoice : cloudArr.last_selected);
  const cloudTime = Array.isArray(cloudArr)
    ? (Number.isFinite(cloudArr[2]) ? cloudArr[2] : 0)
    : (Number.isFinite(cloudArr.time) ? cloudArr.time : (Date.parse(cloudArr.last_wrong_time) || 0));
  const mastered = Array.isArray(cloudArr) ? Boolean(cloudArr[3]) : Boolean(cloudArr.mastered);

  return {
    question_id: parseInt(qid, 10) || qid,
    wrong_count: wrongCnt,
    last_selected: lastSelStr ? lastSelStr.split('') : [],
    last_wrong_time: new Date(cloudTime || Date.now()).toISOString(),
    mastered
  };
}

/**
 * 将完整 userData ({ answers, mistakes }) 转换为云同步紧凑格式
 */
export function toCompactPayload(userData) {
  const compactAnswers = {};
  const compactMistakes = {};
  const answers = (userData && userData.answers) || {};
  const mistakes = (userData && userData.mistakes) || {};

  for (const [qid, rec] of Object.entries(answers)) {
    if (!rec || !isSafeQid(qid)) continue;
    const encoded = encodeCompactAnswer(rec);
    if (encoded) compactAnswers[qid] = encoded;
  }

  for (const [qid, rec] of Object.entries(mistakes)) {
    if (!rec || !isSafeQid(qid)) continue;
    const encoded = encodeCompactMistake(rec);
    if (encoded) compactMistakes[qid] = encoded;
  }

  return { answers: compactAnswers, mistakes: compactMistakes };
}

/**
 * 按最新时间戳将云端紧凑数据合并到本地 userData（返回合并后的新 userData 副本）
 */
export function mergeFromCompactPayload(userData, cloudData) {
  const merged = {
    answers: { ...((userData && userData.answers) || {}) },
    mistakes: { ...((userData && userData.mistakes) || {}) }
  };
  const cloudAnswers = (cloudData && cloudData.answers) || {};
  const cloudMistakes = (cloudData && cloudData.mistakes) || {};

  for (const [qid, cloudArr] of Object.entries(cloudAnswers)) {
    if (!cloudArr || !isSafeQid(qid)) continue;
    const cloudTime = Array.isArray(cloudArr) ? (cloudArr[2] || 0) : (cloudArr.time || 0);
    const localRec = merged.answers[qid];
    const localTime = localRec && localRec.updated_at ? Date.parse(localRec.updated_at) || 0 : 0;

    if (!localRec || cloudTime > localTime) {
      merged.answers[qid] = decodeCompactAnswer(cloudArr, localRec);
    }
  }

  for (const [qid, cloudArr] of Object.entries(cloudMistakes)) {
    if (!cloudArr || !isSafeQid(qid)) continue;
    const cloudTime = Array.isArray(cloudArr) ? (cloudArr[2] || 0) : (cloudArr.time || 0);
    const localRec = merged.mistakes[qid];
    const localTime = localRec && localRec.last_wrong_time ? Date.parse(localRec.last_wrong_time) || 0 : 0;

    if (!localRec || cloudTime > localTime) {
      merged.mistakes[qid] = decodeCompactMistake(cloudArr, qid);
    }
  }

  return merged;
}

/**
 * 从云端紧凑数据直接生成完整本地 userData 快照
 */
export function snapshotFromCompactPayload(cloudData) {
  const newUserData = { answers: {}, mistakes: {} };
  const cloudAnswers = (cloudData && cloudData.answers) || {};
  const cloudMistakes = (cloudData && cloudData.mistakes) || {};

  for (const [qid, cloudArr] of Object.entries(cloudAnswers)) {
    if (!cloudArr || !isSafeQid(qid)) continue;
    newUserData.answers[qid] = decodeCompactAnswer(cloudArr, null);
  }

  for (const [qid, cloudArr] of Object.entries(cloudMistakes)) {
    if (!cloudArr || !isSafeQid(qid)) continue;
    newUserData.mistakes[qid] = decodeCompactMistake(cloudArr, qid);
  }

  return newUserData;
}

/**
 * 计算紧凑同步数据的确定性 FNV-1a 指纹（忽略时间戳字段，仅当真实作答/掌握状态变化时才变化）
 */
export function computeDataFingerprint(compactData) {
  if (!compactData) return 'empty';
  const ans = compactData.answers || {};
  const mis = compactData.mistakes || {};
  const ansKeys = Object.keys(ans).sort();
  const misKeys = Object.keys(mis).sort();

  const parts = [];
  for (const k of ansKeys) {
    const a = ans[k];
    if (Array.isArray(a)) {
      parts.push(`A:${k}:${a[0] || ''}:${a[1] ?? -1}:${a[3] ? 1 : 0}`);
    }
  }
  for (const k of misKeys) {
    const m = mis[k];
    if (Array.isArray(m)) {
      parts.push(`M:${k}:${m[0] || 1}:${m[1] || ''}:${m[3] ? 1 : 0}`);
    }
  }
  const raw = parts.join('|');
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16)}_${ansKeys.length}_${misKeys.length}`;
}

/**
 * 计算题库大厅总览与各板块/章节统计信息
 */
export function computeOverview(questionsData, userData) {
  const answers = (userData && userData.answers) || {};
  const mistakes = (userData && userData.mistakes) || {};

  if (!questionsData || !questionsData.subjects_tree || !questionsData.questions) {
    return {
      total_questions: 0,
      total_answered: 0,
      total_correct: 0,
      total_mistakes: 0,
      overall_accuracy: 0,
      subjects: []
    };
  }

  const subjects = [];
  for (const [partName, chapters] of Object.entries(questionsData.subjects_tree)) {
    const subjectInfo = {
      name: partName,
      total: 0,
      answered: 0,
      correct: 0,
      mistakes: 0,
      accuracy: 0,
      chapters: []
    };

    for (const [chName, typesCnt] of Object.entries(chapters)) {
      const singleCnt = typesCnt['单项选择题'] || 0;
      const multiCnt = typesCnt['多项选择题'] || 0;
      const chTotal = singleCnt + multiCnt;
      const chQIds = questionsData.questions
        .filter(q => q.part === partName && q.chapter === chName)
        .map(q => q.id);

      const chAnswered = chQIds.filter(qid => answers[qid] && answers[qid].selected && answers[qid].selected.length > 0).length;
      const chGraded = chQIds.filter(qid => answers[qid] && (answers[qid].is_correct === true || answers[qid].is_correct === false)).length;
      const chCorrect = chQIds.filter(qid => answers[qid] && answers[qid].is_correct === true).length;
      const chMistakes = chQIds.filter(qid => mistakes[qid] && !mistakes[qid].mastered).length;
      const chAccuracy = chGraded > 0 ? Math.round((chCorrect / chGraded) * 1000) / 10 : 0;

      subjectInfo.chapters.push({
        name: chName,
        total: chTotal,
        single_count: singleCnt,
        multi_count: multiCnt,
        answered: chAnswered,
        graded: chGraded,
        correct: chCorrect,
        mistakes: chMistakes,
        accuracy: chAccuracy,
        has_std_answers: true
      });

      subjectInfo.total += chTotal;
      subjectInfo.answered += chAnswered;
      subjectInfo.graded = (subjectInfo.graded || 0) + chGraded;
      subjectInfo.correct += chCorrect;
      subjectInfo.mistakes += chMistakes;
    }

    subjectInfo.accuracy = (subjectInfo.graded || 0) > 0
      ? Math.round((subjectInfo.correct / subjectInfo.graded) * 1000) / 10
      : 0;
    subjects.push(subjectInfo);
  }

  const validQidSet = new Set(questionsData.questions.map(q => q.id));
  const totalAnswered = Object.entries(answers).filter(([qid, a]) => validQidSet.has(qid) && a && a.selected && a.selected.length > 0).length;
  const totalGraded = Object.entries(answers).filter(([qid, a]) => validQidSet.has(qid) && a && (a.is_correct === true || a.is_correct === false)).length;
  const totalCorrect = Object.entries(answers).filter(([qid, a]) => validQidSet.has(qid) && a && a.is_correct === true).length;
  const totalMistakes = Object.entries(mistakes).filter(([qid, m]) => validQidSet.has(qid) && m && !m.mastered).length;
  const overallAccuracy = totalGraded > 0 ? Math.round((totalCorrect / totalGraded) * 1000) / 10 : 0;

  return {
    total_questions: questionsData.total || questionsData.questions.length,
    total_answered: totalAnswered,
    total_correct: totalCorrect,
    total_mistakes: totalMistakes,
    overall_accuracy: overallAccuracy,
    subjects
  };
}

/**
 * 按板块、章节、题型和练习模式筛选题目列表
 */
export function filterQuestions(questionsData, userData, { part = '', chapter = '', qType = '', mode = 'instant' } = {}) {
  if (!questionsData || !questionsData.questions) {
    return { count: 0, total: 0, questions: [] };
  }
  const answers = (userData && userData.answers) || {};
  const mistakes = (userData && userData.mistakes) || {};

  const matched = [];
  for (const q of questionsData.questions) {
    if (part && q.part !== part) continue;
    if (chapter && q.chapter !== chapter) continue;
    if (qType && q.type !== qType) continue;
    if (mode === 'mistakes_only') {
      if (!mistakes[q.id] || mistakes[q.id].mastered) continue;
    }

    const qCopy = { ...q };
    const rec = answers[q.id];
    if (rec) {
      qCopy.user_selected = Array.isArray(rec.selected) ? [...rec.selected] : [];
      qCopy.user_time = rec.time_spent || 0;
      qCopy.is_flagged = !!rec.is_flagged;
      qCopy.is_correct = rec.is_correct !== undefined ? rec.is_correct : null;
    } else {
      qCopy.user_selected = [];
      qCopy.user_time = 0;
      qCopy.is_flagged = false;
      qCopy.is_correct = null;
    }

    qCopy.in_mistakes = Boolean(mistakes[q.id] && !mistakes[q.id].mastered);

    // 错题特训模式：重置为白板重做状态
    if (mode === 'mistakes_only') {
      qCopy.user_selected = [];
      qCopy.user_time = 0;
      qCopy.is_correct = null;
    }

    // 模考模式：白板开考，交卷前隐藏答案与解析
    if (mode === 'exam') {
      qCopy.user_selected = [];
      qCopy.user_time = 0;
      qCopy.is_correct = null;
      qCopy.answer = null;
      qCopy.source = null;
      qCopy.analysis = null;
      qCopy.tips = null;
      qCopy.tag = null;
    }

    matched.push(qCopy);
  }

  return {
    count: matched.length,
    part,
    chapter,
    type: qType,
    mode,
    questions: matched
  };
}

/**
 * 构建错题本展示列表（排除已掌握题目，按题号排序）
 */
export function computeMistakesList(questionsMap, userData, { part = '', chapter = '' } = {}) {
  const mistakes = (userData && userData.mistakes) || {};
  const answers = (userData && userData.answers) || {};
  const map = questionsMap || {};

  const list = [];
  for (const [qid, mInfo] of Object.entries(mistakes)) {
    if (!mInfo || mInfo.mastered) continue;
    const q = map[qid];
    if (!q) continue;
    if (part && q.part !== part) continue;
    if (chapter && q.chapter !== chapter) continue;

    const item = { ...q };
    item.mistake_info = mInfo;
    const ansSelected = (answers[qid] && Array.isArray(answers[qid].selected) && answers[qid].selected.length > 0)
      ? answers[qid].selected
      : (mInfo.last_selected || []);
    item.user_selected = ansSelected;
    list.push(item);
  }

  list.sort((a, b) => a.id.localeCompare(b.id));
  return { count: list.length, mistakes: list };
}
