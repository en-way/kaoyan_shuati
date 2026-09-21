/**
 * 2027 考研政治 1000 题 · 沉浸式做题系统
 * 全量官方解析版 · 支持纯静态部署 (Cloudflare Pages / GitHub Pages / 本地运行)
 * 采用浏览器 localStorage 持久化作答记录与错题集，支持跨端导入/导出同步进度
 */

// ================== PURE CLIENT-SIDE DATA LAYER ==================
const DB = {
  questionsData: null,
  questionsMap: {},

  // Initialize and load questions database
  async init() {
    if (!this.questionsData) {
      try {
        const res = await fetch('data/questions.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.questionsData = await res.json();
      } catch (e) {
        // Fallback for different subpaths
        try {
          const res2 = await fetch('./data/questions.json');
          this.questionsData = await res2.json();
        } catch (e2) {
          console.error('Failed to load questions.json:', e2);
          alert('未能加载题库文件 data/questions.json，请检查网络或部署路径！');
          return;
        }
      }

      this.questionsMap = {};
      this.questionsData.questions.forEach(q => {
        this.questionsMap[q.id] = q;
      });
    }
  },

  getUserData() {
    try {
      const s = localStorage.getItem('quiz_user_data_2027');
      if (s) {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed === 'object') {
          if (!parsed.answers) parsed.answers = {};
          if (!parsed.mistakes) parsed.mistakes = {};
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Error reading localStorage:', e);
    }
    return { answers: {}, mistakes: {} };
  },

  saveUserData(data) {
    try {
      localStorage.setItem('quiz_user_data_2027', JSON.stringify(data));
      if (window.App && App.auth && typeof App.auth.markDirty === 'function') {
        App.auth.markDirty();
      }
    } catch (e) {
      console.error('Failed to save user data to localStorage:', e);
    }
  },

  toCompact() {
    const userData = this.getUserData();
    const compactAnswers = {};
    const compactMistakes = {};

    for (const [qid, rec] of Object.entries(userData.answers || {})) {
      if (!rec) continue;
      const selStr = Array.isArray(rec.selected) ? rec.selected.join('') : (rec.selected || '');
      const isCorr = rec.is_correct ? 1 : 0;
      const t = rec.updated_at ? (Date.parse(rec.updated_at) || Date.now()) : Date.now();
      compactAnswers[qid] = [selStr, isCorr, t];
    }

    for (const [qid, rec] of Object.entries(userData.mistakes || {})) {
      if (!rec) continue;
      const lastSelStr = Array.isArray(rec.last_selected) ? rec.last_selected.join('') : (rec.last_selected || '');
      const t = rec.last_wrong_time ? (Date.parse(rec.last_wrong_time) || Date.now()) : Date.now();
      compactMistakes[qid] = [rec.wrong_count || 1, lastSelStr, t, rec.mastered ? 1 : 0];
    }

    return { answers: compactAnswers, mistakes: compactMistakes };
  },

  mergeFromCompact(cloudData) {
    const userData = this.getUserData();
    const cloudAnswers = cloudData.answers || {};
    const cloudMistakes = cloudData.mistakes || {};

    // 智能合并 answers: 以最新时间戳为准
    for (const [qid, cloudArr] of Object.entries(cloudAnswers)) {
      if (!cloudArr) continue;
      const cloudTime = Array.isArray(cloudArr) ? (cloudArr[2] || 0) : (cloudArr.time || 0);
      const localRec = userData.answers[qid];
      const localTime = localRec && localRec.updated_at ? Date.parse(localRec.updated_at) || 0 : 0;

      if (!localRec || cloudTime > localTime) {
        const selStr = Array.isArray(cloudArr) ? cloudArr[0] : (cloudArr.choice || '');
        const isCorr = Array.isArray(cloudArr) ? Boolean(cloudArr[1]) : Boolean(cloudArr.correct);
        userData.answers[qid] = {
          selected: selStr ? selStr.split('') : [],
          is_correct: isCorr,
          time_spent: localRec ? localRec.time_spent || 0 : 0,
          updated_at: new Date(cloudTime || Date.now()).toISOString()
        };
      }
    }

    // 智能合并 mistakes
    for (const [qid, cloudArr] of Object.entries(cloudMistakes)) {
      if (!cloudArr) continue;
      const cloudTime = Array.isArray(cloudArr) ? (cloudArr[2] || 0) : (cloudArr.time || 0);
      const localRec = userData.mistakes[qid];
      const localTime = localRec && localRec.last_wrong_time ? Date.parse(localRec.last_wrong_time) || 0 : 0;

      if (!localRec || cloudTime > localTime) {
        const wrongCnt = Array.isArray(cloudArr) ? cloudArr[0] : (cloudArr.count || 1);
        const lastSelStr = Array.isArray(cloudArr) ? cloudArr[1] : (cloudArr.lastChoice || '');
        const mastered = Array.isArray(cloudArr) ? Boolean(cloudArr[3]) : false;
        userData.mistakes[qid] = {
          question_id: parseInt(qid, 10) || qid,
          wrong_count: wrongCnt,
          last_selected: lastSelStr ? lastSelStr.split('') : [],
          last_wrong_time: new Date(cloudTime || Date.now()).toISOString(),
          mastered: mastered
        };
      }
    }

    localStorage.setItem('quiz_user_data_2027', JSON.stringify(userData));
    return userData;
  },

  setFromCloud(cloudData) {
    const newUserData = { answers: {}, mistakes: {} };
    const cloudAnswers = cloudData ? (cloudData.answers || {}) : {};
    const cloudMistakes = cloudData ? (cloudData.mistakes || {}) : {};

    for (const [qid, cloudArr] of Object.entries(cloudAnswers)) {
      if (!cloudArr) continue;
      const selStr = Array.isArray(cloudArr) ? cloudArr[0] : (cloudArr.choice || '');
      const isCorr = Array.isArray(cloudArr) ? Boolean(cloudArr[1]) : Boolean(cloudArr.correct);
      const cloudTime = Array.isArray(cloudArr) ? (cloudArr[2] || 0) : (cloudArr.time || 0);
      newUserData.answers[qid] = {
        selected: selStr ? selStr.split('') : [],
        is_correct: isCorr,
        time_spent: 0,
        updated_at: new Date(cloudTime || Date.now()).toISOString()
      };
    }

    for (const [qid, cloudArr] of Object.entries(cloudMistakes)) {
      if (!cloudArr) continue;
      const wrongCnt = Array.isArray(cloudArr) ? cloudArr[0] : (cloudArr.count || 1);
      const lastSelStr = Array.isArray(cloudArr) ? cloudArr[1] : (cloudArr.lastChoice || '');
      const cloudTime = Array.isArray(cloudArr) ? (cloudArr[2] || 0) : (cloudArr.time || 0);
      const mastered = Array.isArray(cloudArr) ? Boolean(cloudArr[3]) : false;
      newUserData.mistakes[qid] = {
        question_id: parseInt(qid, 10) || qid,
        wrong_count: wrongCnt,
        last_selected: lastSelStr ? lastSelStr.split('') : [],
        last_wrong_time: new Date(cloudTime || Date.now()).toISOString(),
        mastered: mastered
      };
    }

    localStorage.setItem('quiz_user_data_2027', JSON.stringify(newUserData));
    return newUserData;
  },

  getOverview() {
    const userData = this.getUserData();
    const answers = userData.answers || {};
    const mistakes = userData.mistakes || {};

    const subjects = [];
    for (const [partName, chapters] of Object.entries(this.questionsData.subjects_tree)) {
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
        const chTotal = typesCnt['单项选择题'] + typesCnt['多项选择题'];
        const chQIds = this.questionsData.questions
          .filter(q => q.part === partName && q.chapter === chName)
          .map(q => q.id);

        const chAnswered = chQIds.filter(qid => answers[qid] && answers[qid].selected && answers[qid].selected.length > 0).length;
        const chCorrect = chQIds.filter(qid => answers[qid] && answers[qid].is_correct === true).length;
        const chMistakes = chQIds.filter(qid => mistakes[qid] && !mistakes[qid].mastered).length;
        const chAccuracy = chAnswered > 0 ? Math.round((chCorrect / chAnswered) * 1000) / 10 : 0;

        subjectInfo.chapters.push({
          name: chName,
          total: chTotal,
          single_count: typesCnt['单项选择题'],
          multi_count: typesCnt['多项选择题'],
          answered: chAnswered,
          correct: chCorrect,
          mistakes: chMistakes,
          accuracy: chAccuracy,
          has_std_answers: true
        });

        subjectInfo.total += chTotal;
        subjectInfo.answered += chAnswered;
        subjectInfo.correct += chCorrect;
        subjectInfo.mistakes += chMistakes;
      }

      subjectInfo.accuracy = subjectInfo.answered > 0
        ? Math.round((subjectInfo.correct / subjectInfo.answered) * 1000) / 10
        : 0;
      subjects.push(subjectInfo);
    }

    const totalAnswered = Object.values(answers).filter(a => a && a.selected && a.selected.length > 0).length;
    const totalCorrect = Object.values(answers).filter(a => a && a.is_correct === true).length;
    const totalMistakes = Object.values(mistakes).filter(m => m && !m.mastered).length;
    const overallAccuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 1000) / 10 : 0;

    return {
      total_questions: this.questionsData.total,
      total_answered: totalAnswered,
      total_correct: totalCorrect,
      total_mistakes: totalMistakes,
      overall_accuracy: overallAccuracy,
      subjects: subjects
    };
  },

  getQuestions(part, chapter, qType, mode) {
    const userData = this.getUserData();
    const answers = userData.answers || {};
    const mistakes = userData.mistakes || {};

    const matched = [];
    for (const q of this.questionsData.questions) {
      if (part && q.part !== part) continue;
      if (chapter && q.chapter !== chapter) continue;
      if (qType && q.type !== qType) continue;
      if (mode === 'mistakes_only') {
        if (!mistakes[q.id] || mistakes[q.id].mastered) continue;
      }

      const qCopy = { ...q };
      const rec = answers[q.id];
      if (rec) {
        qCopy.user_selected = rec.selected || [];
        qCopy.user_time = rec.time_spent || 0;
        qCopy.is_flagged = !!rec.is_flagged;
        qCopy.is_correct = rec.is_correct !== undefined ? rec.is_correct : null;
      } else {
        qCopy.user_selected = [];
        qCopy.user_time = 0;
        qCopy.is_flagged = false;
        qCopy.is_correct = null;
      }

      qCopy.in_mistakes = (mistakes[q.id] && !mistakes[q.id].mastered);

      // In exam mode, hide standard answers until submitted
      if (mode === 'exam' && qCopy.is_correct === null) {
        qCopy.answer = null;
        qCopy.source = null;
        qCopy.analysis = null;
        qCopy.tips = null;
        qCopy.tag = null;
      }

      matched.append ? matched.append(qCopy) : matched.push(qCopy);
    }

    return {
      count: matched.length,
      part,
      chapter,
      type: qType,
      mode,
      questions: matched
    };
  },

  saveAnswer(qid, selected, timeSpent, isFlagged, evalNow = true) {
    const q = this.questionsMap[qid];
    if (!q) return { success: false, error: 'Question not found' };

    const userData = this.getUserData();
    const userStr = selected.slice().sort().join('');
    const stdAns = q.answer || '';
    const isCorrect = (evalNow && userStr) ? (userStr === stdAns) : null;

    if (!userData.answers[qid]) {
      userData.answers[qid] = {};
    }

    const rec = userData.answers[qid];
    rec.selected = selected;
    rec.time_spent = timeSpent;
    rec.is_flagged = isFlagged;
    rec.is_correct = isCorrect;
    rec.updated_at = new Date().toISOString();

    if (evalNow && userStr) {
      if (!isCorrect) {
        if (!userData.mistakes[qid]) {
          userData.mistakes[qid] = { question_id: qid, wrong_count: 0 };
        }
        userData.mistakes[qid].wrong_count = (userData.mistakes[qid].wrong_count || 0) + 1;
        userData.mistakes[qid].last_selected = selected;
        userData.mistakes[qid].standard_answer = stdAns;
        userData.mistakes[qid].mastered = false;
        userData.mistakes[qid].last_wrong_time = new Date().toISOString();
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
    if (!userData.answers[qid]) {
      userData.answers[qid] = { selected: [], time_spent: 0, is_flagged: true };
    } else {
      userData.answers[qid].is_flagged = !userData.answers[qid].is_flagged;
    }
    this.saveUserData(userData);
    return userData.answers[qid].is_flagged;
  },

  submitExam(part, chapter) {
    const userData = this.getUserData();
    const chQuestions = this.questionsData.questions.filter(q => q.part === part && q.chapter === chapter);

    let correctCnt = 0;
    let wrongCnt = 0;
    let unansweredCnt = 0;
    const results = [];

    for (const q of chQuestions) {
      const qid = q.id;
      const rec = userData.answers[qid] || {};
      const selected = rec.selected || [];
      const userStr = selected.slice().sort().join('');
      const stdAns = q.answer || '';

      let isCorr = false;
      if (!userStr) {
        unansweredCnt++;
      } else if (userStr === stdAns) {
        correctCnt++;
        isCorr = true;
        rec.is_correct = true;
        if (userData.mistakes[qid]) userData.mistakes[qid].mastered = true;
      } else {
        wrongCnt++;
        isCorr = false;
        rec.is_correct = false;
        if (!userData.mistakes[qid]) {
          userData.mistakes[qid] = { question_id: qid, wrong_count: 0 };
        }
        userData.mistakes[qid].wrong_count = (userData.mistakes[qid].wrong_count || 0) + 1;
        userData.mistakes[qid].last_selected = selected;
        userData.mistakes[qid].standard_answer = stdAns;
        userData.mistakes[qid].mastered = false;
        userData.mistakes[qid].last_wrong_time = new Date().toISOString();
      }

      rec.is_correct = isCorr;
      userData.answers[qid] = rec;

      results.push({
        id: qid,
        num: q.num,
        type: q.type,
        stem: q.stem,
        user_ans: userStr || '未作答',
        standard_ans: stdAns,
        is_correct: isCorr,
        source: q.source || '',
        analysis: q.analysis || '',
        tips: q.tips || '',
        tag: q.tag || ''
      });
    }

    this.saveUserData(userData);

    const totalGraded = correctCnt + wrongCnt;
    const scoreRate = chQuestions.length > 0 ? Math.round((correctCnt / chQuestions.length) * 1000) / 10 : 0;
    const accuracy = totalGraded > 0 ? Math.round((correctCnt / totalGraded) * 1000) / 10 : 0;

    return {
      success: true,
      total: chQuestions.length,
      correct_count: correctCnt,
      wrong_count: wrongCnt,
      unanswered_count: unansweredCnt,
      accuracy,
      score_rate: scoreRate,
      results
    };
  },

  resetChapter(part, chapter) {
    const userData = this.getUserData();
    const chQIds = this.questionsData.questions
      .filter(q => q.part === part && q.chapter === chapter)
      .map(q => q.id);

    for (const qid of chQIds) {
      if (userData.answers[qid]) {
        delete userData.answers[qid];
      }
    }
    this.saveUserData(userData);
    return { success: true, cleared_count: chQIds.length };
  },

  getMistakes(part, chapter) {
    const userData = this.getUserData();
    const mistakes = userData.mistakes || {};
    const answers = userData.answers || {};

    const list = [];
    for (const [qid, mInfo] of Object.entries(mistakes)) {
      if (mInfo && mInfo.mastered) continue;
      const q = this.questionsMap[qid];
      if (!q) continue;
      if (part && q.part !== part) continue;
      if (chapter && q.chapter !== chapter) continue;

      const item = { ...q };
      item.mistake_info = mInfo;
      item.user_selected = (answers[qid] && answers[qid].selected) || mInfo.last_selected || [];
      list.push(item);
    }

    list.sort((a, b) => a.id.localeCompare(b.id));
    return { count: list.length, mistakes: list };
  },

  mistakeAction(qid, action) {
    const userData = this.getUserData();
    if (userData.mistakes && userData.mistakes[qid]) {
      if (action === 'remove' || action === 'master') {
        userData.mistakes[qid].mastered = true;
      } else if (action === 'unmaster') {
        userData.mistakes[qid].mastered = false;
      }
      this.saveUserData(userData);
      return { success: true };
    }
    return { success: false, error: 'Not found' };
  }
};


// ================== APPLICATION UI CONTROLLER ==================
const App = {
  state: {
    currentView: 'hub',
    overview: null,
    activeSubjectIndex: 0,
    currentPart: '',
    currentChapter: '',
    currentType: '',
    practiceMode: 'instant',
    questions: [],
    currentIndex: 0,
    selectedOptions: [],
    isFlagged: false,
    isEvaluated: false,
    explanationVisible: true,

    questionSeconds: 0,
    sessionSeconds: 0,
    questionTimerTimer: null,
    sessionTimerTimer: null,

    mistakesList: [],
    filterPart: '',
    filterChapter: ''
  },

  async init() {
    this.startSessionTimer();
    this.bindGlobalKeys();
    this.bindTouchGestures();
    this.registerServiceWorker();
    await DB.init();
    this.auth.init();
    this.loadOverview();
    this.initLanUrl();
  },

  // ================== CLOUD USER AUTH & SYNC CONTROLLER ==================
  auth: {
    currentUser: null,
    token: localStorage.getItem('kaoyan_jwt_token_2027') || null,
    isDirty: false,
    lastSyncTime: localStorage.getItem('kaoyan_last_sync_time_2027') ? parseInt(localStorage.getItem('kaoyan_last_sync_time_2027'), 10) : null,
    isSyncing: false,
    _lastAdminResult: null,

    init() {
      // 点击页面任意空白处关闭用户下拉菜单
      document.addEventListener('click', () => {
        this.closeUserMenu();
      });

      if (this.token) {
        this.checkSession();
      } else {
        this.renderAuthUI();
      }
      this.updateSyncUI();
    },

    markDirty() {
      this.isDirty = true;
      this.updateSyncUI();
    },

    // 渲染用户状态与界面各按钮
    renderAuthUI() {
      const btnOpenAuth = document.getElementById('btnOpenAuth');
      const userLoggedInBlock = document.getElementById('userLoggedInBlock');
      const userNicknameDisplay = document.getElementById('userNicknameDisplay');
      const menuUsername = document.getElementById('menuUsername');
      const mBtnSync = document.getElementById('mBtnSync');
      const mUserNotLoggedIn = document.getElementById('mUserNotLoggedIn');
      const mUserLoggedIn = document.getElementById('mUserLoggedIn');
      const mUserNickname = document.getElementById('mUserNickname');

      if (this.currentUser) {
        // Desktop
        if (btnOpenAuth) btnOpenAuth.style.display = 'none';
        if (userLoggedInBlock) userLoggedInBlock.style.display = 'inline-flex';
        if (userNicknameDisplay) userNicknameDisplay.textContent = this.currentUser.nickname || this.currentUser.username;
        if (menuUsername) menuUsername.textContent = `@${this.currentUser.username}`;
        
        // Mobile User Card
        if (mUserNotLoggedIn) mUserNotLoggedIn.style.display = 'none';
        if (mUserLoggedIn) mUserLoggedIn.style.display = 'flex';
        if (mUserNickname) mUserNickname.textContent = this.currentUser.nickname || this.currentUser.username;
      } else {
        // Desktop
        if (btnOpenAuth) btnOpenAuth.style.display = 'inline-block';
        if (userLoggedInBlock) userLoggedInBlock.style.display = 'none';
        
        // Mobile User Card
        if (mUserNotLoggedIn) mUserNotLoggedIn.style.display = 'flex';
        if (mUserLoggedIn) mUserLoggedIn.style.display = 'none';
      }

      this.updateSyncUI();
    },

    // 更新同步指示灯与文字
    updateSyncUI() {
      const desktopSyncIcon = document.getElementById('desktopSyncIcon');
      const desktopSyncText = document.getElementById('desktopSyncText');
      const btnUploadCloud = document.getElementById('btnUploadCloud') || document.getElementById('btnSyncCloud');
      const menuSyncTime = document.getElementById('menuSyncTime');
      const mUserSyncStatus = document.getElementById('mUserSyncStatus');

      // Mobile dual button elements
      const mBtnUploadCloud = document.getElementById('mBtnUploadCloud');
      const mCloudUploadIcon = document.getElementById('mCloudUploadIcon');
      const mCloudUploadText = document.getElementById('mCloudUploadText');

      let timeStr = '未保存';
      if (this.lastSyncTime) {
        const d = new Date(this.lastSyncTime);
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        timeStr = `${m}-${day} ${h}:${min}`;
      }

      if (this.isSyncing) {
        if (btnUploadCloud) {
          btnUploadCloud.classList.add('syncing');
          btnUploadCloud.classList.remove('dirty');
        }
        if (desktopSyncIcon) desktopSyncIcon.textContent = '🔄';
        if (desktopSyncText) desktopSyncText.textContent = '保存中...';

        if (mBtnUploadCloud) {
          mBtnUploadCloud.classList.add('syncing');
          mBtnUploadCloud.classList.remove('dirty');
        }
        if (mCloudUploadIcon) mCloudUploadIcon.textContent = '🔄';
        if (mCloudUploadText) mCloudUploadText.textContent = '保存中...';
        if (mUserSyncStatus) mUserSyncStatus.textContent = '正在保存至云端...';
      } else if (this.isDirty) {
        if (btnUploadCloud) {
          btnUploadCloud.classList.remove('syncing');
          btnUploadCloud.classList.add('dirty');
        }
        if (desktopSyncIcon) desktopSyncIcon.textContent = '🟡';
        if (desktopSyncText) desktopSyncText.textContent = '保存云端';

        if (mBtnUploadCloud) {
          mBtnUploadCloud.classList.remove('syncing');
          mBtnUploadCloud.classList.add('dirty');
        }
        if (mCloudUploadIcon) mCloudUploadIcon.textContent = '🟡';
        if (mCloudUploadText) mCloudUploadText.textContent = '保存云端';
        if (mUserSyncStatus) mUserSyncStatus.textContent = '本地有新答题，点击上传保存';
        if (menuSyncTime) menuSyncTime.textContent = `上次保存: ${timeStr} (有未上传)`;
      } else {
        if (btnUploadCloud) {
          btnUploadCloud.classList.remove('syncing', 'dirty');
        }
        if (desktopSyncIcon) desktopSyncIcon.textContent = '☁️';
        if (desktopSyncText) desktopSyncText.textContent = '已存云端';

        if (mBtnUploadCloud) {
          mBtnUploadCloud.classList.remove('syncing', 'dirty');
        }
        if (mCloudUploadIcon) mCloudUploadIcon.textContent = '☁️';
        if (mCloudUploadText) mCloudUploadText.textContent = '上传云端';
        if (mUserSyncStatus) mUserSyncStatus.textContent = `云端已保存 (${timeStr})`;
        if (menuSyncTime) menuSyncTime.textContent = `上次保存: ${timeStr}`;
      }
    },

    toggleUserMenu(e) {
      if (e) e.stopPropagation();
      const menu = document.getElementById('userDropdownMenu');
      if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      }
    },

    closeUserMenu() {
      const menu = document.getElementById('userDropdownMenu');
      if (menu) menu.style.display = 'none';
    },

    openAuthModal(tab = 'login') {
      this.closeUserMenu();
      const modal = document.getElementById('authModal');
      if (modal) {
        modal.style.display = 'flex';
        this.switchTab(tab);
      }
    },

    closeAuthModal(e) {
      if (e && e.target && e.target !== e.currentTarget) return;
      const modal = document.getElementById('authModal');
      if (modal) modal.style.display = 'none';
      this.showNotice('', 'none');
    },

    switchTab(tab) {
      this.showNotice('', 'none');
      const tabs = ['login', 'register', 'reset'];
      tabs.forEach(t => {
        const btn = document.getElementById(`authTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
        const form = document.getElementById(`form${t.charAt(0).toUpperCase() + t.slice(1)}`);
        if (btn) btn.classList.toggle('active', t === tab);
        if (form) form.style.display = t === tab ? 'block' : 'none';
      });

      const titleEl = document.getElementById('authModalTitle');
      if (titleEl) {
        if (tab === 'login') titleEl.textContent = '考研政治 · 用户登录';
        else if (tab === 'register') titleEl.textContent = '考研政治 · 新用户注册';
        else if (tab === 'reset') titleEl.textContent = '考研政治 · 重置密码';
      }
    },

    showNotice(msg, type = 'error') {
      const notice = document.getElementById('authNotice');
      if (!notice) return;
      if (!msg) {
        notice.style.display = 'none';
        return;
      }
      notice.textContent = msg;
      notice.className = `auth-notice ${type}`;
      notice.style.display = 'block';
    },

    // 1. 用户登录
    async handleLogin(e) {
      e.preventDefault();
      const username = (document.getElementById('loginUsername').value || '').trim();
      const password = document.getElementById('loginPassword').value || '';
      const submitBtn = document.getElementById('btnLoginSubmit');

      if (!username || !password) {
        this.showNotice('请输入账号与密码', 'error');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = '登录中...';
        this.showNotice('', 'none');

        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '登录失败，请检查账号密码');
        }

        this.setSession(data.token, data.user);
        this.closeAuthModal();

        // 关键防竞态：清除旧同步时间戳，强制向云端全量拉取，避免被 304 拦截导致本地空数据
        this.lastSyncTime = null;
        localStorage.removeItem('kaoyan_last_sync_time_2027');
        localStorage.removeItem('quiz_user_data_2027');

        localStorage.setItem('kaoyan_last_session_check_2027', String(Date.now()));
        // 登录成功瞬间自动拉取该账号在云端的真实进度覆盖本地
        await this.downloadFromCloud(true);
        this.renderAuthUI();
        App.loadOverview();
        alert(`欢迎回来，${data.user.nickname || data.user.username}！已为您清除本地临时数据，并成功载入您的专属云端进度。`);
      } catch (err) {
        this.showNotice(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '立即登录并同步';
      }
    },

    // 2. 新用户注册
    async handleRegister(e) {
      e.preventDefault();
      const username = (document.getElementById('regUsername').value || '').trim();
      const nickname = (document.getElementById('regNickname').value || '').trim();
      const password = document.getElementById('regPassword').value || '';
      const submitBtn = document.getElementById('btnRegSubmit');

      if (!username || !password) {
        this.showNotice('请填写完整的账号与密码', 'error');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = '注册中...';
        this.showNotice('', 'none');

        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, nickname, password })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '注册失败');
        }

        this.setSession(data.token, data.user);
        this.closeAuthModal();

        // 关键防污染：新账号彻底清空本地临时做题数据，以 0 进度全新起步（不上传本地脏数据）
        localStorage.removeItem('quiz_user_data_2027');
        DB.setFromCloud({ answers: {}, mistakes: {}, updatedAt: Date.now() });
        this.lastSyncTime = Date.now();
        localStorage.setItem('kaoyan_last_sync_time_2027', String(this.lastSyncTime));
        localStorage.setItem('kaoyan_last_session_check_2027', String(this.lastSyncTime));
        localStorage.setItem('kaoyan_last_upload_hash_2027', this.computeDataFingerprint(DB.toCompact()));
        this.isDirty = false;
        this.updateSyncUI();
        App.loadOverview();
        alert(`注册成功！已为您自动登录，新账号初始进度为 0，请开始学习！`);
      } catch (err) {
        this.showNotice(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '立即注册';
      }
    },

    // 3. 学员重置密码
    async handleResetPassword(e) {
      e.preventDefault();
      const username = (document.getElementById('resetUsername').value || '').trim();
      const code = (document.getElementById('resetCode').value || '').trim();
      const newPassword = document.getElementById('resetNewPassword').value || '';
      const submitBtn = document.getElementById('btnResetSubmit');

      if (!username || !code || !newPassword) {
        this.showNotice('请填写账号、6位重置码与新密码', 'error');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = '重置中...';
        this.showNotice('', 'none');

        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, code, newPassword })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '重置密码失败');
        }

        this.setSession(data.token, data.user);
        this.closeAuthModal();

        // 关键防污染与防竞态：清除旧时间戳后全量拉取
        this.lastSyncTime = null;
        localStorage.removeItem('kaoyan_last_sync_time_2027');
        localStorage.removeItem('quiz_user_data_2027');
        localStorage.setItem('kaoyan_last_session_check_2027', String(Date.now()));
        await this.downloadFromCloud(true);
        this.renderAuthUI();
        App.loadOverview();
        alert('密码重置成功！已自动为您登录，并载入您的云端学习记录。');
      } catch (err) {
        this.showNotice(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '确认重置并自动登录';
      }
    },

    // 管理员面板
    openAdminModal() {
      this.closeAuthModal();
      const modal = document.getElementById('adminModal');
      const resultBox = document.getElementById('adminResultBox');
      const notice = document.getElementById('adminNotice');
      const secretInput = document.getElementById('adminSecretKey');
      const clearLink = document.getElementById('adminClearSecretLink');

      if (modal) modal.style.display = 'flex';
      if (resultBox) resultBox.style.display = 'none';
      if (notice) notice.style.display = 'none';

      // 自动恢复管理员本机记住的密钥
      const savedSecret = localStorage.getItem('kaoyan_admin_secret_saved') || '';
      if (secretInput && savedSecret) {
        secretInput.value = savedSecret;
        if (clearLink) clearLink.style.display = 'inline';
      } else if (clearLink) {
        clearLink.style.display = 'none';
      }
    },

    closeAdminModal(e) {
      if (e && e.target && e.target !== e.currentTarget) return;
      const modal = document.getElementById('adminModal');
      if (modal) modal.style.display = 'none';
    },

    // 快捷测试密钥有效性
    async verifyAdminSecret() {
      const secretInput = document.getElementById('adminSecretKey');
      const notice = document.getElementById('adminNotice');
      const clearLink = document.getElementById('adminClearSecretLink');
      const secret = (secretInput ? secretInput.value : '').trim();

      if (!secret) {
        if (notice) {
          notice.textContent = '请先在上方输入需要测试的管理员密钥';
          notice.className = 'auth-notice error';
          notice.style.display = 'block';
        }
        if (secretInput) secretInput.focus();
        return;
      }

      try {
        if (notice) {
          notice.textContent = '正在与 Cloudflare 边缘服务器比对密钥...';
          notice.className = 'auth-notice';
          notice.style.display = 'block';
        }

        const res = await fetch('/api/admin/verify-secret', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': secret
          },
          body: JSON.stringify({ adminSecret: secret })
        });

        const data = await res.json();
        if (!res.ok || !data.isValid) {
          throw new Error(data.error || '密钥校验失败');
        }

        // 验证通过，持久化保存在当前浏览器
        localStorage.setItem('kaoyan_admin_secret_saved', secret);
        if (clearLink) clearLink.style.display = 'inline';

        if (notice) {
          notice.textContent = data.message || '✅ 密钥有效！';
          notice.className = data.isCustomConfigured ? 'auth-notice success' : 'auth-notice warning';
          notice.style.display = 'block';
        }
      } catch (err) {
        if (notice) {
          notice.textContent = `❌ ${err.message}`;
          notice.className = 'auth-notice error';
          notice.style.display = 'block';
        }
      }
    },

    // 清除本地已保存的密钥
    clearSavedAdminSecret() {
      localStorage.removeItem('kaoyan_admin_secret_saved');
      const secretInput = document.getElementById('adminSecretKey');
      const clearLink = document.getElementById('adminClearSecretLink');
      const notice = document.getElementById('adminNotice');
      if (secretInput) secretInput.value = '';
      if (clearLink) clearLink.style.display = 'none';
      if (notice) {
        notice.textContent = '已清除本浏览器记住的管理员密钥';
        notice.className = 'auth-notice';
        notice.style.display = 'block';
      }
    },

    async handleAdminGenerateCode(e) {
      e.preventDefault();
      const adminSecret = (document.getElementById('adminSecretKey').value || '').trim();
      const username = (document.getElementById('adminTargetUsername').value || '').trim();
      const notice = document.getElementById('adminNotice');
      const resultBox = document.getElementById('adminResultBox');
      const codeDisplay = document.getElementById('adminGeneratedCode');
      const submitBtn = document.getElementById('btnAdminGenerate');
      const clearLink = document.getElementById('adminClearSecretLink');

      if (!adminSecret || !username) {
        notice.textContent = '请输入管理员密钥与学员账号';
        notice.className = 'auth-notice error';
        notice.style.display = 'block';
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = '生成中...';
        notice.style.display = 'none';

        const res = await fetch('/api/admin/generate-reset-code', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': adminSecret
          },
          body: JSON.stringify({ adminSecret, username })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '生成重置码失败');
        }

        // 成功生成时，顺便在管理员本机持久记住该密钥
        localStorage.setItem('kaoyan_admin_secret_saved', adminSecret);
        if (clearLink) clearLink.style.display = 'inline';

        codeDisplay.textContent = data.code;
        resultBox.style.display = 'block';
        notice.textContent = `学员「${data.nickname || data.username}」的 6 位重置码已生成！`;
        notice.className = 'auth-notice success';
        notice.style.display = 'block';

        this._lastAdminResult = {
          username: data.username,
          code: data.code,
          expiresIn: 30
        };
      } catch (err) {
        notice.textContent = err.message;
        notice.className = 'auth-notice error';
        notice.style.display = 'block';
        resultBox.style.display = 'none';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '⚡ 生成 6 位重置验证码';
      }
    },

    copyAdminGeneratedCode() {
      if (!this._lastAdminResult) return;
      const text = `【考研政治 1000 题】学员 ${this._lastAdminResult.username}，您的密码重置码为：${this._lastAdminResult.code}，请在 30 分钟内点击登录界面的「忘记密码」输入该验证码重置新密码。`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          alert('重置码及使用说明已复制到剪贴板，可直接粘贴发送给学员！');
        }).catch(() => {
          prompt('请复制以下重置文本发给学员：', text);
        });
      } else {
        prompt('请复制以下重置文本发给学员：', text);
      }
    },

    // 核心安全清理：当云端数据库被清空或用户被删除时，自动彻底清空本地所有答题记录与缓存
    purgeAllUserData(reason) {
      localStorage.removeItem('quiz_user_data_2027');
      localStorage.removeItem('kaoyan_jwt_token_2027');
      localStorage.removeItem('kaoyan_user_info_2027');
      localStorage.removeItem('kaoyan_last_sync_time_2027');
      localStorage.removeItem('kaoyan_last_session_check_2027');
      localStorage.removeItem('kaoyan_last_upload_hash_2027');

      this.token = null;
      this.currentUser = null;
      this.isDirty = false;
      this.lastSyncTime = null;

      // 清空全局内存中的题目与做题状态
      if (App.state) {
        App.state.questions = [];
        App.state.mistakesList = [];
        App.state.overview = null;
        App.state.currentIndex = 0;
        App.state.selectedOptions = [];
        App.state.isEvaluated = false;
        App.state.isFlagged = false;
      }

      if (reason) {
        alert(reason);
      }
      location.reload();
    },

    setSession(token, user) {
      this.token = token;
      this.currentUser = user;
      localStorage.setItem('kaoyan_jwt_token_2027', token);
      if (user) {
        localStorage.setItem('kaoyan_user_info_2027', JSON.stringify(user));
      }
      this.renderAuthUI();
    },

    // 计算做题数据轻量级指纹（仅针对实际答题与错题状态，过滤动态时间戳，防误判）
    computeDataFingerprint(compactData) {
      if (!compactData) return '0';
      const answers = compactData.answers || {};
      const mistakes = compactData.mistakes || {};
      const contentStr = JSON.stringify({ a: answers, m: mistakes });
      let hash = 5381;
      for (let i = 0; i < contentStr.length; i++) {
        hash = ((hash << 5) + hash) + contentStr.charCodeAt(i);
        hash |= 0;
      }
      const ansCount = Object.keys(answers).length;
      const misCount = Object.keys(mistakes).length;
      return `${ansCount}_${misCount}_${hash}`;
    },

    async checkSession() {
      if (!this.token) return;
      try {
        const cachedUser = localStorage.getItem('kaoyan_user_info_2027');
        if (cachedUser) {
          try {
            this.currentUser = JSON.parse(cachedUser);
            this.renderAuthUI();
          } catch (e) {}
        }

        const now = Date.now();
        const lastCheck = parseInt(localStorage.getItem('kaoyan_last_session_check_2027') || '0', 10);
        // 30分钟节流：30分钟内若已成功联网校验过，直接复用本地有效会话，避免无意义消耗 Worker 与 D1 读配额
        if (lastCheck && (now - lastCheck < 30 * 60 * 1000) && this.currentUser) {
          return;
        }

        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });

        // 关键逻辑：如果云端返回 404（用户已不存在或数据库被清空）或 401（未授权）
        if (res.status === 404 || res.status === 401) {
          this.purgeAllUserData('您的账号已被管理员注销或下线，本地数据已自动清空。');
          return;
        }

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.user) {
            this.currentUser = data.user;
            localStorage.setItem('kaoyan_user_info_2027', JSON.stringify(data.user));
            localStorage.setItem('kaoyan_last_session_check_2027', String(now));
            this.renderAuthUI();
          }
        }
      } catch (e) {
        // 离线或本地测试时忽略网络报错
      }
    },

    logout(promptUser = true) {
      if (promptUser) {
        const confirmLogout = confirm('确定要退出当前账号登录吗？退出后将清空本机答题记录。');
        if (!confirmLogout) return;
        this.purgeAllUserData('已成功退出登录，本地所有答题记录已全部清空。');
        return;
      }
      this.purgeAllUserData();
    },

    resetLocalData() {
      if (!confirm('⚠️ 确定要清空本机所有的刷题记录与错题本吗？\n清空后所有答题进度与错题归零，此操作不可撤销！')) {
        return;
      }
      localStorage.removeItem('quiz_user_data_2027');
      localStorage.removeItem('kaoyan_last_sync_time_2027');
      localStorage.removeItem('kaoyan_last_upload_hash_2027');
      this.isDirty = false;
      this.lastSyncTime = null;

      if (App.state) {
        App.state.questions = [];
        App.state.mistakesList = [];
        App.state.overview = null;
        App.state.currentIndex = 0;
        App.state.selectedOptions = [];
        App.state.isEvaluated = false;
        App.state.isFlagged = false;
      }

      alert('本地所有刷题记录与错题本已成功清空！');
      location.reload();
    },

    // 功能 1：☁️ 上传到云端（带客户端与服务端双重防重复拦截，0请求/0写入）
    async uploadToCloud(isSilent = false) {
      if (!this.token) {
        if (!isSilent) this.openAuthModal('login');
        return;
      }

      // 采集本地当前全部真实做题数据快照与指纹
      const compactData = DB.toCompact();
      const currentHash = this.computeDataFingerprint(compactData);
      const lastUploadHash = localStorage.getItem('kaoyan_last_upload_hash_2027');

      // 客户端防重复拦截：数据未变化且无未保存操作，直接跳过请求，节省 100% Worker 请求与 D1 写入配额！
      if (!this.isDirty && lastUploadHash && lastUploadHash === currentHash) {
        if (!isSilent) {
          alert('💡 当前做题进度已与云端一致，无需重复保存！');
        }
        this.updateSyncUI();
        return;
      }

      if (!isSilent) {
        const ok = confirm('⚠️ 确定要上传当前数据覆盖云端吗？');
        if (!ok) return;
      }

      if (this.isSyncing) return;

      try {
        this.isSyncing = true;
        this.updateSyncUI();

        const res = await fetch('/api/progress/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ ...compactData, dataHash: currentHash })
        });

        if (res.status === 404 || res.status === 401) {
          this.purgeAllUserData('您的账号已被管理员注销或下线，本地数据已自动清空。');
          return;
        }

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '上传保存失败');
        }

        this.lastSyncTime = data.updatedAt || Date.now();
        localStorage.setItem('kaoyan_last_sync_time_2027', String(this.lastSyncTime));
        localStorage.setItem('kaoyan_last_upload_hash_2027', currentHash);
        this.isDirty = false;
        this.updateSyncUI();

        if (!isSilent) {
          if (data.notModified) {
            alert('💡 当前做题进度已与云端一致，无需重复保存！');
          } else {
            alert('☁️ 当前最新做题记录与错题本已成功保存至云端数据库！');
          }
        }
      } catch (err) {
        console.error('Upload failed:', err);
        if (!isSilent) {
          alert(`上传保存失败: ${err.message || err}`);
        }
      } finally {
        this.isSyncing = false;
        this.updateSyncUI();
      }
    },

    // 功能 2：📥 从云端下载（带增量时间戳比对，防全量无用传输与覆盖）
    async downloadFromCloud(isSilent = false) {
      if (!this.token) {
        if (!isSilent) this.openAuthModal('login');
        return;
      }

      if (!isSilent) {
        const ok = confirm('⚠️ 确定要从云端下载数据吗？\n下载后将用云端保存的进度覆盖本机当前数据。');
        if (!ok) return;
      }

      if (this.isSyncing) return;

      try {
        this.isSyncing = true;
        this.updateSyncUI();

        const clientTime = this.lastSyncTime || 0;
        const res = await fetch(`/api/progress/sync?clientTime=${clientTime}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        });

        if (res.status === 404 || res.status === 401) {
          this.purgeAllUserData('您的账号已被管理员注销或下线，本地数据已自动清空。');
          return;
        }

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '从云端下载失败');
        }

        // 云端未变动防重复覆盖（节省宽带与无意义 DOM 重载）
        if (data.notModified) {
          this.isDirty = false;
          this.updateSyncUI();
          if (!isSilent) {
            alert('💡 云端数据与本机一致（无更新），无需重复覆盖！');
          }
          return;
        }

        // 以云端真实保存的数据全量覆盖本地
        DB.setFromCloud(data);
        this.lastSyncTime = data.updatedAt || Date.now();
        localStorage.setItem('kaoyan_last_sync_time_2027', String(this.lastSyncTime));
        const newCompact = DB.toCompact();
        localStorage.setItem('kaoyan_last_upload_hash_2027', this.computeDataFingerprint(newCompact));
        this.isDirty = false;
        this.updateSyncUI();

        if (!isSilent) {
          alert('📥 云端数据下载成功！即将刷新页面呈现最新进度。');
          location.reload();
        }
      } catch (err) {
        console.error('Download failed:', err);
        if (!isSilent) {
          alert(`下载失败: ${err.message || err}`);
        }
      } finally {
        this.isSyncing = false;
        this.updateSyncUI();
      }
    },

    // 兼容旧调用别名
    async syncProgress(isSilent = false) {
      return this.uploadToCloud(isSilent);
    },
    async fetchCloudProgress() {
      return this.downloadFromCloud(true);
    }
  },

  // ================== TIMERS ==================
  startSessionTimer() {
    this.state.sessionTimerTimer = setInterval(() => {
      this.state.sessionSeconds++;
      const h = Math.floor(this.state.sessionSeconds / 3600);
      const m = Math.floor((this.state.sessionSeconds % 3600) / 60);
      const s = this.state.sessionSeconds % 60;
      const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      const el = document.getElementById('sessionTimer');
      if (el) el.textContent = formatted;
      const mEl = document.getElementById('mSheetSessionTimer');
      if (mEl) mEl.textContent = formatted;
    }, 1000);
  },

  resetQuestionTimer() {
    if (this.state.questionTimerTimer) {
      clearInterval(this.state.questionTimerTimer);
    }
    const currentQ = this.getCurrentQuestion();
    this.state.questionSeconds = currentQ ? (currentQ.user_time || 0) : 0;
    this.updateQuestionTimerDisplay();

    this.state.questionTimerTimer = setInterval(() => {
      this.state.questionSeconds++;
      this.updateQuestionTimerDisplay();
    }, 1000);
  },

  updateQuestionTimerDisplay() {
    const m = Math.floor(this.state.questionSeconds / 60);
    const s = this.state.questionSeconds % 60;
    const formatted = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const el = document.getElementById('questionTimer');
    if (el) el.textContent = formatted;
    const mEl = document.getElementById('mSheetQuestionTimer');
    if (mEl) mEl.textContent = formatted;
  },

  // ================== NAVIGATION ==================
  navigateTo(viewName) {
    this.state.currentView = viewName;
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.m-nav-item').forEach(btn => btn.classList.remove('active'));

    if (viewName === 'hub') {
      document.getElementById('viewHub').classList.add('active');
      document.getElementById('navHubBtn').classList.add('active');
      const mBtn = document.getElementById('mNavHubBtn');
      if (mBtn) mBtn.classList.add('active');
      this.loadOverview();
    } else if (viewName === 'practice') {
      document.getElementById('viewPractice').classList.add('active');
      document.getElementById('navPracticeBtn').classList.add('active');
      const mBtn = document.getElementById('mNavPracticeBtn');
      if (mBtn) mBtn.classList.add('active');
      if (!this.state.questions.length) {
        this.startPractice('第一部分 马克思主义基本原理', '导论', '', 'instant');
      } else {
        this.renderQuestion();
      }
    } else if (viewName === 'mistakes') {
      document.getElementById('viewMistakes').classList.add('active');
      document.getElementById('navMistakesBtn').classList.add('active');
      const mBtn = document.getElementById('mNavMistakesBtn');
      if (mBtn) mBtn.classList.add('active');
      this.loadMistakes();
    }
  },

  // ================== VIEW 1: HUB ==================
  loadOverview() {
    const data = DB.getOverview();
    this.state.overview = data;

    document.getElementById('hubTotalQ').textContent = data.total_questions.toLocaleString();
    document.getElementById('hubAnsweredQ').textContent = data.total_answered.toLocaleString();
    document.getElementById('hubMistakesQ').textContent = data.total_mistakes.toLocaleString();
    document.getElementById('hubAccuracyRate').textContent = `${data.overall_accuracy}%`;
    
    const badge = document.getElementById('globalMistakeBadge');
    if (badge) badge.textContent = data.total_mistakes;
    const mBadge = document.getElementById('mGlobalMistakeBadge');
    if (mBadge) mBadge.textContent = data.total_mistakes;

    this.renderSubjectTabs();
    this.renderChaptersGrid();
  },

  renderSubjectTabs() {
    const container = document.getElementById('subjectTabsContainer');
    if (!container || !this.state.overview) return;

    container.innerHTML = this.state.overview.subjects.map((sub, idx) => {
      const active = idx === this.state.activeSubjectIndex ? 'active' : '';
      const shortName = sub.name.replace(/^第[一二三四五]部分\s*/, '');
      return `
        <button class="subject-tab ${active}" onclick="App.selectSubjectTab(${idx})">
          <span>${shortName}</span>
          <span style="font-size: 11px; opacity: 0.7;">(${sub.answered}/${sub.total})</span>
        </button>
      `;
    }).join('');
  },

  selectSubjectTab(idx) {
    this.state.activeSubjectIndex = idx;
    this.renderSubjectTabs();
    this.renderChaptersGrid();
  },

  renderChaptersGrid() {
    const container = document.getElementById('chaptersGridContainer');
    if (!container || !this.state.overview) return;

    const currentSub = this.state.overview.subjects[this.state.activeSubjectIndex];
    if (!currentSub) return;

    container.innerHTML = currentSub.chapters.map(ch => {
      const percent = ch.total > 0 ? Math.round((ch.answered / ch.total) * 100) : 0;
      const accBadge = ch.answered > 0 
        ? `<span class="ch-acc-badge">正确率 ${ch.accuracy}%</span>`
        : `<span class="ch-acc-badge empty">未答</span>`;

      const mistakePill = ch.mistakes > 0 
        ? `<button class="btn-mistake-pill" onclick="App.startPractice('${currentSub.name}', '${ch.name}', '', 'mistakes_only')">❌ 错题 (${ch.mistakes})</button>` 
        : '';

      return `
        <div class="chapter-card">
          <div class="chapter-card-header">
            <h4 class="chapter-title">${ch.name}</h4>
            ${accBadge}
          </div>

          <div class="chapter-meta-row">
            <span>单选: <strong>${ch.single_count}</strong> | 多选: <strong>${ch.multi_count}</strong></span>
            <span>进度: <strong>${ch.answered}/${ch.total}</strong> (${percent}%)</span>
          </div>

          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${percent}%;"></div>
          </div>

          <div class="chapter-actions-row">
            <button class="btn-card-primary" onclick="App.startPractice('${currentSub.name}', '${ch.name}', '', 'instant')">
              ⚡ 即时刷题
            </button>
            <button class="btn-card-secondary" onclick="App.startPractice('${currentSub.name}', '${ch.name}', '', 'exam')">
              📝 模考
            </button>
            <button class="btn-card-secondary" onclick="App.startPractice('${currentSub.name}', '${ch.name}', '', 'recite')">
              📖 背题
            </button>
          </div>

          <div class="chapter-sub-actions">
            <div>${mistakePill}</div>
            <button class="btn-reset-ch" onclick="App.resetChapter('${currentSub.name}', '${ch.name}')">
              🔄 重置本章
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  resetChapter(part, chapter) {
    if (!confirm(`确定要重置【${chapter}】的作答记录吗？该章节的历史答题数据将被清空。`)) {
      return;
    }
    DB.resetChapter(part, chapter);
    this.loadOverview();
  },

  // ================== VIEW 2: PRACTICE STREAM ==================
  startPractice(part, chapter, type = '', mode = 'instant') {
    this.state.currentPart = part;
    this.state.currentChapter = chapter;
    this.state.currentType = type;
    this.state.practiceMode = mode;
    this.state.currentIndex = 0;
    this.state.explanationVisible = true;

    const shortSub = part ? this.getSubjectShortName(part) : '全科错题';
    const chTitle = chapter || (mode === 'mistakes_only' ? '专项特训' : '全部章节');
    const crumbEl = document.getElementById('crumbSubject');
    if (crumbEl) crumbEl.textContent = `${shortSub} · ${chTitle}`;

    const data = DB.getQuestions(part, chapter, type, mode);
    this.state.questions = data.questions || [];

    this.navigateTo('practice');
    this.updateModePillsUI();
    this.renderQuestion();
  },

  switchMode(newMode) {
    if (this.state.practiceMode === newMode) return;
    this.state.practiceMode = newMode;
    this.updateModePillsUI();
    this.startPractice(this.state.currentPart, this.state.currentChapter, this.state.currentType, newMode);
  },

  updateModePillsUI() {
    const mode = this.state.practiceMode;
    const btnInstant = document.getElementById('modeBtnInstant');
    const btnExam = document.getElementById('modeBtnExam');
    const btnRecite = document.getElementById('modeBtnRecite');
    if (btnInstant) btnInstant.classList.toggle('active', mode === 'instant');
    if (btnExam) btnExam.classList.toggle('active', mode === 'exam');
    if (btnRecite) btnRecite.classList.toggle('active', mode === 'recite');

    // Update Mobile Mode Selector Pill
    const mIcon = document.getElementById('mModePillIcon');
    const mText = document.getElementById('mModePillText');
    const modeMap = {
      'instant': { icon: '⚡', text: '即做即判' },
      'exam': { icon: '📝', text: '模考自测' },
      'recite': { icon: '📖', text: '直接背题' },
      'mistakes_only': { icon: '❌', text: '错题专训' }
    };
    const info = modeMap[mode] || { icon: '⚡', text: '做题模式' };
    if (mIcon) mIcon.textContent = info.icon;
    if (mText) mText.textContent = info.text;

    // Update Mobile ActionSheet items active state
    ['Instant', 'Exam', 'Recite'].forEach(k => {
      const opt = document.getElementById(`mModeOption${k}`);
      if (opt) opt.classList.toggle('active', mode === k.toLowerCase());
    });

    // Update Question More Modal mode buttons
    ['Instant', 'Exam', 'Recite', 'Mistakes'].forEach(k => {
      const btn = document.getElementById(`qMoreMode${k}`);
      if (btn) {
        const isAct = k.toLowerCase() === mode || (k === 'Mistakes' && mode === 'mistakes_only');
        btn.classList.toggle('active', isAct);
      }
    });

    const modeTag = document.getElementById('pModeTag');
    if (modeTag) modeTag.style.display = mode === 'mistakes_only' ? 'inline-block' : 'none';

    const btnExamSubmit = document.getElementById('btnExamSubmit');
    const drawerExam = document.getElementById('drawerExamSubmitBtn');
    if (btnExamSubmit) btnExamSubmit.style.display = (mode === 'exam') ? 'inline-flex' : 'none';
    if (drawerExam) drawerExam.style.display = (mode === 'exam') ? 'block' : 'none';
  },

  getCurrentQuestion() {
    return this.state.questions[this.state.currentIndex];
  },

  renderQuestion() {
    const q = this.getCurrentQuestion();
    const card = document.getElementById('questionCard');
    if (!q) {
      if (card) card.innerHTML = '<div class="q-stem">此分类下暂无题目。</div>';
      return;
    }

    const shortSub = this.getSubjectShortName(q.part);
    document.getElementById('pSubjectTag').textContent = shortSub;
    document.getElementById('pChapterTag').textContent = q.chapter;

    const typeTag = document.getElementById('pTypeTag');
    typeTag.textContent = q.type;
    typeTag.className = `p-type-tag ${q.type === '单项选择题' ? 'type-single' : 'type-multi'}`;

    document.getElementById('pCurrentNum').textContent = this.state.currentIndex + 1;
    document.getElementById('pTotalNum').textContent = this.state.questions.length;
    const mHeaderProg = document.getElementById('mHeaderProgress');
    if (mHeaderProg) {
      mHeaderProg.textContent = `${this.state.currentIndex + 1}/${this.state.questions.length}`;
    }
    document.getElementById('qNumberBadge').textContent = `第 ${q.num} 题`;

    const tagEl = document.getElementById('qSpecialTag');
    if (q.tag) {
      tagEl.textContent = q.tag;
      tagEl.style.display = 'inline-block';
    } else {
      tagEl.style.display = 'none';
    }

    this.state.isFlagged = !!q.is_flagged;
    const flagBtn = document.getElementById('pFlagBtn');
    const flagIcon = document.getElementById('flagIcon');
    const mFlagBtn = document.getElementById('mFlagBtn');
    const mFlagIcon = document.getElementById('mFlagIcon');
    if (this.state.isFlagged) {
      if (flagBtn) flagBtn.classList.add('active');
      if (flagIcon) flagIcon.textContent = '★';
      if (mFlagBtn) mFlagBtn.classList.add('active');
      if (mFlagIcon) mFlagIcon.textContent = '★';
    } else {
      if (flagBtn) flagBtn.classList.remove('active');
      if (flagIcon) flagIcon.textContent = '☆';
      if (mFlagBtn) mFlagBtn.classList.remove('active');
      if (mFlagIcon) mFlagIcon.textContent = '☆';
    }

    // Update Mobile Card Top Row & Question More Menu status
    const mProgress = document.getElementById('mCardProgress');
    if (mProgress) {
      mProgress.textContent = `${this.state.currentIndex + 1}/${this.state.questions.length}`;
    }
    const mType = document.getElementById('mCardTypeTag');
    if (mType) {
      mType.textContent = q.type === '多项选择题' ? '多选' : '单选';
      mType.className = `p-type-tag ${q.type === '单项选择题' ? 'type-single' : 'type-multi'}`;
    }
    const mSub = document.getElementById('mCardSubjectTag');
    if (mSub) {
      mSub.textContent = shortSub;
    }
    const mSpecTag = document.getElementById('mCardSpecialTag');
    if (mSpecTag) {
      if (q.tag) {
        mSpecTag.textContent = q.tag;
        mSpecTag.style.display = 'inline-block';
      } else {
        mSpecTag.style.display = 'none';
      }
    }
    const qMoreIcon = document.getElementById('qMoreFlagIcon');
    const qMoreTitle = document.getElementById('qMoreFlagTitle');
    if (qMoreIcon) qMoreIcon.textContent = this.state.isFlagged ? '★' : '☆';
    if (qMoreTitle) qMoreTitle.textContent = this.state.isFlagged ? '已标记本题 (点击取消)' : '标记本题';

    document.getElementById('qStem').textContent = q.stem;

    const subItemsContainer = document.getElementById('qSubItems');
    if (q.sub_items && q.sub_items.length > 0) {
      subItemsContainer.style.display = 'flex';
      subItemsContainer.innerHTML = q.sub_items.map(s => `<div class="sub-item-line">${s}</div>`).join('');
    } else {
      subItemsContainer.style.display = 'none';
    }

    this.state.selectedOptions = [...(q.user_selected || [])];
    this.state.isEvaluated = (q.is_correct !== null && q.is_correct !== undefined);

    const mode = this.state.practiceMode;
    const optionsContainer = document.getElementById('qOptions');
    const stdAns = q.answer || '';

    optionsContainer.innerHTML = q.options.map(opt => {
      const isSelected = this.state.selectedOptions.includes(opt.key);
      let extraClass = isSelected ? 'selected' : '';

      if (mode === 'recite') {
        if (stdAns.includes(opt.key)) {
          extraClass += ' is-correct-std';
        }
      } else if (mode === 'instant' || mode === 'mistakes_only') {
        if (this.state.isEvaluated) {
          if (stdAns.includes(opt.key)) {
            extraClass += ' is-correct-std';
          } else if (isSelected) {
            extraClass += ' is-wrong-selected';
          }
        }
      }

      return `
        <div class="option-item ${extraClass}" onclick="App.onOptionClick('${opt.key}')">
          <div class="option-key-badge">${opt.key}</div>
          <div class="option-text">${opt.text}</div>
        </div>
      `;
    }).join('');

    const multiBar = document.getElementById('multiSubmitBar');
    if (q.type === '多项选择题' && (mode === 'instant' || mode === 'mistakes_only') && !this.state.isEvaluated) {
      multiBar.style.display = 'flex';
    } else {
      multiBar.style.display = 'none';
    }

    this.renderExplanationPanel(q);
    this.resetQuestionTimer();
  },

  renderExplanationPanel(q) {
    const panel = document.getElementById('explanationPanel');
    const mode = this.state.practiceMode;
    const shouldShow = (mode === 'recite') || 
      ((mode === 'instant' || mode === 'mistakes_only') && this.state.isEvaluated);

    if (!shouldShow || !this.state.explanationVisible) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = 'flex';
    document.getElementById('explAnswerVal').textContent = q.answer || '—';

    const srcWrap = document.getElementById('explSourceWrap');
    if (q.source) {
      srcWrap.style.display = 'flex';
      document.getElementById('explSourceText').textContent = q.source;
    } else {
      srcWrap.style.display = 'none';
    }

    document.getElementById('explAnalysisText').textContent = q.analysis || '暂无解析';

    const tipsWrap = document.getElementById('explTipsWrap');
    if (q.tips) {
      tipsWrap.style.display = 'flex';
      document.getElementById('explTipsText').textContent = q.tips;
    } else {
      tipsWrap.style.display = 'none';
    }
  },

  toggleExplanationFold() {
    this.state.explanationVisible = !this.state.explanationVisible;
    const q = this.getCurrentQuestion();
    if (q) this.renderExplanationPanel(q);
  },

  // ================== ANSWERING INTERACTIONS ==================
  onOptionClick(key) {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const mode = this.state.practiceMode;

    if (mode === 'recite') return;

    if (q.type === '单项选择题') {
      this.state.selectedOptions = [key];
      q.user_selected = [key];
      q.user_time = this.state.questionSeconds;

      if (mode === 'instant' || mode === 'mistakes_only') {
        this.submitAnswerNow(true);
      } else if (mode === 'exam') {
        this.submitAnswerNow(false);
        this.renderQuestion();
      }
    } else {
      if (this.state.selectedOptions.includes(key)) {
        this.state.selectedOptions = this.state.selectedOptions.filter(k => k !== key);
      } else {
        this.state.selectedOptions.push(key);
        this.state.selectedOptions.sort();
      }
      q.user_selected = [...this.state.selectedOptions];
      q.user_time = this.state.questionSeconds;

      if (mode === 'exam') {
        this.submitAnswerNow(false);
      }
      this.renderQuestion();
    }
  },

  submitCurrentMultiChoice() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    if (this.state.selectedOptions.length === 0) {
      alert('请先选择选项！');
      return;
    }
    this.submitAnswerNow(true);
  },

  submitAnswerNow(evalNow = true) {
    const q = this.getCurrentQuestion();
    if (!q) return;

    const res = DB.saveAnswer(
      q.id,
      this.state.selectedOptions,
      this.state.questionSeconds,
      this.state.isFlagged,
      evalNow
    );

    if (evalNow) {
      this.state.isEvaluated = true;
      q.is_correct = res.is_correct;
    }
    this.renderQuestion();
  },

  animateCard(direction = 'left') {
    const card = document.getElementById('questionCard');
    if (!card) return;
    card.classList.remove('anim-slide-left', 'anim-slide-right');
    void card.offsetWidth; // 触发 DOM 回流以重播 CSS 动效
    card.classList.add(direction === 'left' ? 'anim-slide-left' : 'anim-slide-right');
  },

  prevQuestion() {
    if (this.state.currentIndex > 0) {
      this.state.currentIndex--;
      this.renderQuestion();
      this.animateCard('right');
    }
  },

  nextQuestion() {
    const q = this.getCurrentQuestion();
    const mode = this.state.practiceMode;

    if (q && q.type === '多项选择题' && (mode === 'instant' || mode === 'mistakes_only') && !this.state.isEvaluated && this.state.selectedOptions.length > 0) {
      this.submitCurrentMultiChoice();
      return;
    }

    if (this.state.currentIndex < this.state.questions.length - 1) {
      this.state.currentIndex++;
      this.renderQuestion();
      this.animateCard('left');
    } else {
      if (mode === 'exam') {
        this.submitExam();
      } else {
        alert('🎉 恭喜！你已完成本章节的所有题目！');
        this.navigateTo('hub');
      }
    }
  },

  jumpToQuestion(index) {
    if (index >= 0 && index < this.state.questions.length) {
      const dir = index >= this.state.currentIndex ? 'left' : 'right';
      this.state.currentIndex = index;
      this.renderQuestion();
      this.animateCard(dir);
      this.closeDrawer();
    }
  },

  toggleFlagCurrent() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    this.state.isFlagged = !this.state.isFlagged;
    q.is_flagged = this.state.isFlagged;
    DB.toggleFlag(q.id);

    const flagBtn = document.getElementById('pFlagBtn');
    const flagIcon = document.getElementById('flagIcon');
    const mFlagBtn = document.getElementById('mFlagBtn');
    const mFlagIcon = document.getElementById('mFlagIcon');
    if (this.state.isFlagged) {
      if (flagBtn) flagBtn.classList.add('active');
      if (flagIcon) flagIcon.textContent = '★';
      if (mFlagBtn) mFlagBtn.classList.add('active');
      if (mFlagIcon) mFlagIcon.textContent = '★';
    } else {
      if (flagBtn) flagBtn.classList.remove('active');
      if (flagIcon) flagIcon.textContent = '☆';
      if (mFlagBtn) mFlagBtn.classList.remove('active');
      if (mFlagIcon) mFlagIcon.textContent = '☆';
    }

    const qMoreIcon = document.getElementById('qMoreFlagIcon');
    const qMoreTitle = document.getElementById('qMoreFlagTitle');
    if (qMoreIcon) qMoreIcon.textContent = this.state.isFlagged ? '★' : '☆';
    if (qMoreTitle) qMoreTitle.textContent = this.state.isFlagged ? '已标记本题 (点击取消)' : '标记本题';
  },

  // ================== EXAM SUBMISSION ==================
  submitExam() {
    if (!confirm('确定要提交本次模考交卷吗？系统将立即统一批改并生成成绩单。')) {
      return;
    }

    const data = DB.submitExam(this.state.currentPart, this.state.currentChapter);

    document.getElementById('examReportAccuracy').textContent = `${data.score_rate}%`;
    document.getElementById('examTotalQ').textContent = data.total;
    document.getElementById('examCorrectQ').textContent = data.correct_count;
    document.getElementById('examWrongQ').textContent = data.wrong_count;
    document.getElementById('examUnansweredQ').textContent = data.unanswered_count;

    const listContainer = document.getElementById('examReportList');
    listContainer.innerHTML = data.results.map(r => {
      const rowClass = r.is_correct ? 'row-correct' : 'row-wrong';
      const icon = r.is_correct ? '<span style="color:var(--accent-green)">✓</span>' : '<span style="color:var(--accent-coral)">✗</span>';
      return `
        <div class="report-row ${rowClass}">
          <span>${icon} <strong>第 ${r.num} 题</strong> (${r.type})</span>
          <span>你的选择: <code>${r.user_ans}</code></span>
          <span>正确答案: <strong style="color:var(--accent-green)">${r.standard_ans}</strong></span>
        </div>
      `;
    }).join('');

    document.getElementById('examReportModal').style.display = 'flex';
    this.closeDrawer();
  },

  closeExamReportModal() {
    document.getElementById('examReportModal').style.display = 'none';
    this.navigateTo('hub');
  },

  reviewExamQuestions() {
    document.getElementById('examReportModal').style.display = 'none';
    this.startPractice(this.state.currentPart, this.state.currentChapter, '', 'instant');
  },

  // ================== QUESTION DRAWER ==================
  openDrawer() {
    const container = document.getElementById('drawerGridContainer');
    if (!container) return;

    const mode = this.state.practiceMode;

    container.innerHTML = this.state.questions.map((q, idx) => {
      let stateClass = '';
      if (idx === this.state.currentIndex) stateClass += ' current';
      if (q.is_flagged) stateClass += ' is-flagged';

      if (mode === 'exam') {
        if (q.user_selected && q.user_selected.length > 0) {
          stateClass += ' has-answered';
        }
      } else {
        if (q.is_correct === true) {
          stateClass += ' is-correct';
        } else if (q.is_correct === false) {
          stateClass += ' is-wrong';
        } else if (q.user_selected && q.user_selected.length > 0) {
          stateClass += ' has-answered';
        }
      }

      return `
        <button class="grid-q-btn ${stateClass}" onclick="App.jumpToQuestion(${idx})">
          ${q.num}
        </button>
      `;
    }).join('');

    document.getElementById('questionDrawer').style.display = 'flex';
  },

  closeDrawer(event) {
    if (event && event.target && event.target.id !== 'questionDrawer' && !event.target.classList.contains('drawer-close')) {
      return;
    }
    document.getElementById('questionDrawer').style.display = 'none';
  },

  // ================== VIEW 3: MISTAKES VAULT ==================
  loadMistakes() {
    const part = this.state.filterPart;
    const chapter = this.state.filterChapter;
    const data = DB.getMistakes(part, chapter);
    this.state.mistakesList = data.mistakes || [];

    document.getElementById('mMistakesCountText').textContent = `共 ${data.count} 道待攻克错题`;
    const globalBadge = document.getElementById('globalMistakeBadge');
    if (globalBadge) globalBadge.textContent = data.count;

    this.populateMistakeFilters();
    this.renderMistakesList();
  },

  getSubjectShortName(part) {
    if (!part) return '';
    if (part.includes('马克思主义基本原理')) return '马原';
    if (part.includes('毛泽东思想')) return '毛中特';
    if (part.includes('习近平新时代')) return '习思想';
    if (part.includes('近现代史纲要')) return '史纲';
    if (part.includes('思想道德与法治')) return '思修';
    return part.replace(/^第[一二三四五]部分\s*/, '');
  },

  populateMistakeFilters() {
    // 提取所有未攻克的完整错题用于构建筛选器各级选项统计
    const allMistakesData = DB.getMistakes('', '');
    const allList = allMistakesData.mistakes || [];
    const totalAllCount = allList.length;

    // 按科目和章节聚合错题数量
    const statsByPart = {};
    allList.forEach(m => {
      const p = m.part || '其他';
      const ch = m.chapter || '未分类';
      if (!statsByPart[p]) {
        statsByPart[p] = { count: 0, chapters: {} };
      }
      statsByPart[p].count++;
      statsByPart[p].chapters[ch] = (statsByPart[p].chapters[ch] || 0) + 1;
    });

    // 填充科目下拉框
    const pSelect = document.getElementById('mPartFilter');
    if (pSelect) {
      const currentPart = this.state.filterPart || '';
      let partHtml = `<option value="">全部科目 (${totalAllCount}题)</option>`;
      
      if (this.state.overview && this.state.overview.subjects) {
        this.state.overview.subjects.forEach(s => {
          const count = statsByPart[s.name] ? statsByPart[s.name].count : 0;
          const shortName = this.getSubjectShortName(s.name);
          const sel = s.name === currentPart ? 'selected' : '';
          partHtml += `<option value="${s.name}" ${sel}>${shortName} (${count}题)</option>`;
        });
      } else {
        Object.entries(statsByPart).forEach(([pName, pStat]) => {
          const shortName = this.getSubjectShortName(pName);
          const sel = pName === currentPart ? 'selected' : '';
          partHtml += `<option value="${pName}" ${sel}>${shortName} (${pStat.count}题)</option>`;
        });
      }
      pSelect.innerHTML = partHtml;
    }

    // 联动填充章节下拉框
    this.populateMistakeChapterOptions(statsByPart, totalAllCount);

    // 动态刷新顶部专项特训按钮
    this.updateMistakesTrainingBtn(this.state.mistakesList.length);
  },

  populateMistakeChapterOptions(statsByPart, totalAllCount) {
    const chSelect = document.getElementById('mChapterFilter');
    if (!chSelect) return;

    const currentPart = this.state.filterPart || '';
    const currentChapter = this.state.filterChapter || '';

    let chHtml = '';
    if (currentPart && statsByPart && statsByPart[currentPart]) {
      const pStat = statsByPart[currentPart];
      chHtml += `<option value="">全部章节 (${pStat.count}题)</option>`;
      Object.entries(pStat.chapters).forEach(([chName, count]) => {
        const sel = chName === currentChapter ? 'selected' : '';
        chHtml += `<option value="${chName}" ${sel}>${chName} (${count}题)</option>`;
      });
    } else {
      chHtml += `<option value="">全部章节 (${totalAllCount}题)</option>`;
      if (statsByPart) {
        Object.entries(statsByPart).forEach(([pName, pStat]) => {
          const shortPart = this.getSubjectShortName(pName);
          Object.entries(pStat.chapters).forEach(([chName, count]) => {
            const sel = chName === currentChapter ? 'selected' : '';
            chHtml += `<option value="${chName}" ${sel}>${shortPart} · ${chName} (${count}题)</option>`;
          });
        });
      }
    }
    chSelect.innerHTML = chHtml;
  },

  onPartFilterChange() {
    const pSelect = document.getElementById('mPartFilter');
    this.state.filterPart = pSelect ? pSelect.value : '';
    this.state.filterChapter = '';
    this.loadMistakes();
  },

  onChapterFilterChange() {
    const chSelect = document.getElementById('mChapterFilter');
    this.state.filterChapter = chSelect ? chSelect.value : '';
    this.loadMistakes();
  },

  filterMistakes() {
    this.onPartFilterChange();
  },

  updateMistakesTrainingBtn(count) {
    const btn = document.getElementById('btnStartMistakesTraining');
    if (!btn) return;

    const part = this.state.filterPart || '';
    const chapter = this.state.filterChapter || '';

    if (part && chapter) {
      const shortPart = this.getSubjectShortName(part);
      const shortCh = chapter.length > 10 ? chapter.slice(0, 9) + '…' : chapter;
      btn.innerHTML = `⚡ 专项特训【${shortPart}·${shortCh}】(${count}题)`;
    } else if (part) {
      const shortPart = this.getSubjectShortName(part);
      btn.innerHTML = `⚡ 专项特训【${shortPart}】(${count}题)`;
    } else {
      btn.innerHTML = `⚡ 立即全部错题特训 (${count}题)`;
    }

    btn.disabled = (count === 0);
    btn.style.opacity = count === 0 ? '0.5' : '1';
    btn.style.cursor = count === 0 ? 'not-allowed' : 'pointer';
  },

  renderMistakesList() {
    const container = document.getElementById('mistakesListContainer');
    if (!container) return;

    if (!this.state.mistakesList.length) {
      container.innerHTML = `
        <div style="text-align:center; padding: 48px; color: var(--text-muted);">
          <h3>🎉 暂无待攻克错题！</h3>
          <p style="margin-top: 8px;">在沉浸刷题中做错的题目将自动收录在此处供你专项特训。</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.state.mistakesList.map((m) => {
      const userAns = (m.user_selected && m.user_selected.length > 0) ? m.user_selected.join('') : '未作答';
      const stdAns = m.answer || '—';
      const snippet = m.analysis ? m.analysis.slice(0, 120) + '...' : '';

      return `
        <div class="mistake-card-item">
          <div class="m-item-meta">
            <span class="p-subject-tag">${this.getSubjectShortName(m.part)}</span>
            <span class="p-chapter-tag">${m.chapter}</span>
            <span class="q-badge">第 ${m.num} 题</span>
            <span class="p-type-tag ${m.type === '单项选择题' ? 'type-single' : 'type-multi'}">${m.type}</span>
            ${m.source ? `<span style="font-size:11px; color:var(--accent-cyan);">${m.source}</span>` : ''}
          </div>

          <div class="m-item-stem">${m.stem}</div>

          <div class="m-item-answers">
            <span>你的作答: <strong style="color:var(--accent-coral)">${userAns}</strong></span>
            <span>标准答案: <strong style="color:var(--accent-green)">${stdAns}</strong></span>
          </div>

          ${snippet ? `<div class="m-item-expl-snippet"><strong>【简析要点】</strong> ${snippet}</div>` : ''}

          <div class="m-item-footer">
            <button class="btn-sm-action" onclick="App.markMistakeMastered('${m.id}')">✓ 标为已攻克</button>
            <button class="btn-primary" style="font-size:12px; padding: 6px 14px;" onclick="App.retrySingleMistake('${m.id}')">
              ⚡ 重刷这道题
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  retrySingleMistake(qid) {
    let q = DB.questionsMap[qid];
    if (!q) {
      const num = parseInt(String(qid).replace(/\D/g, ''), 10);
      if (!isNaN(num)) {
        const padId = `Q_${String(num).padStart(4, '0')}`;
        q = DB.questionsMap[padId] || (DB.questionsData && DB.questionsData.questions.find(item => item.num === num));
      }
    }
    if (!q) return;
    this.state.currentPart = q.part;
    this.state.currentChapter = q.chapter;
    this.state.currentType = '';
    this.state.practiceMode = 'instant';
    this.state.currentIndex = 0;
    this.state.explanationVisible = true;

    const shortSub = this.getSubjectShortName(q.part);
    const crumbEl = document.getElementById('crumbSubject');
    if (crumbEl) crumbEl.textContent = `${shortSub} · 错题精练`;

    // 单题独立重做练习模式：初始重置作答状态，保留错题标识
    const qCopy = { ...q, user_selected: [], user_time: 0, is_flagged: false, is_correct: null, in_mistakes: true };
    this.state.questions = [qCopy];

    this.navigateTo('practice');
    this.updateModePillsUI();
    this.renderQuestion();
  },

  markMistakeMastered(qid) {
    DB.mistakeAction(qid, 'master');
    this.loadMistakes();
    this.loadOverview();
  },

  startMistakesTraining() {
    if (!this.state.mistakesList.length) {
      alert('当前筛选条件下暂无待攻克错题！');
      return;
    }
    const part = this.state.filterPart || '';
    const chapter = this.state.filterChapter || '';
    this.startPractice(part, chapter, '', 'mistakes_only');
  },

  // ================== PROGRESS BACKUP / RESTORE ==================
  exportProgress() {
    const userData = DB.getUserData();
    const blob = new Blob([JSON.stringify(userData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `2027考研政治1000题_刷题进度备份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importProgress() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          if (imported && (imported.answers || imported.mistakes)) {
            DB.saveUserData(imported);
            alert('🎉 刷题进度与错题本导入成功！');
            this.loadOverview();
          } else {
            alert('无效的备份文件格式！');
          }
        } catch (err) {
          alert('解析备份文件失败: ' + err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  },

  resetLocalData() {
    this.auth.resetLocalData();
  },

  // ================== PWA & SERVICE WORKER ==================
  registerServiceWorker() {
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
          .then((reg) => {
            console.log('[PWA] Service Worker registered with scope:', reg.scope);
            reg.onupdatefound = () => {
              const installingWorker = reg.installing;
              if (installingWorker) {
                installingWorker.onstatechange = () => {
                  if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('[PWA] New version installed in background.');
                  }
                };
              }
            };
          })
          .catch((err) => {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      });
    }
  },

  // ================== LAN / MOBILE ==================
  initLanUrl() {
    const box = document.getElementById('lanUrlBox');
    if (box) {
      box.textContent = window.location.href;
    }
  },

  openLanModal() {
    document.getElementById('lanModal').style.display = 'flex';
  },

  closeLanModal() {
    document.getElementById('lanModal').style.display = 'none';
  },

  copyLanUrl() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      alert('链接已复制，在手机/iPad浏览器中粘贴即可打开！');
    }).catch(() => {
      alert('复制失败，请手动复制：' + url);
    });
  },

  // ================== MOBILE MORE MENU ==================
  openMoreMenu() {
    const modal = document.getElementById('moreMenuModal');
    if (modal) modal.style.display = 'flex';
  },

  closeMoreMenu(event) {
    if (event && event.target && event.target.id !== 'moreMenuModal' && !event.target.classList.contains('modal-close')) {
      return;
    }
    const modal = document.getElementById('moreMenuModal');
    if (modal) modal.style.display = 'none';
  },

  // ================== MOBILE MODE SELECTOR ==================
  openModeSelect() {
    const modal = document.getElementById('modeSelectModal');
    if (modal) modal.style.display = 'flex';
  },

  closeModeSelect(event) {
    if (event && event.target && event.target.id !== 'modeSelectModal' && !event.target.classList.contains('modal-close')) {
      return;
    }
    const modal = document.getElementById('modeSelectModal');
    if (modal) modal.style.display = 'none';
  },

  selectModeFromSheet(mode) {
    this.closeModeSelect();
    this.switchMode(mode);
  },

  // ================== MOBILE QUESTION MORE MENU ==================
  openQuestionMoreMenu() {
    const modal = document.getElementById('questionMoreModal');
    if (!modal) return;

    // Sync active mode button in question more sheet
    const mode = this.state.practiceMode;
    ['Instant', 'Exam', 'Recite', 'Mistakes'].forEach(k => {
      const btn = document.getElementById(`qMoreMode${k}`);
      if (btn) {
        const isAct = k.toLowerCase() === mode || (k === 'Mistakes' && mode === 'mistakes_only');
        btn.classList.toggle('active', isAct);
      }
    });

    // Sync flag status
    const qMoreIcon = document.getElementById('qMoreFlagIcon');
    const qMoreTitle = document.getElementById('qMoreFlagTitle');
    if (qMoreIcon) qMoreIcon.textContent = this.state.isFlagged ? '★' : '☆';
    if (qMoreTitle) qMoreTitle.textContent = this.state.isFlagged ? '已标记本题 (点击取消)' : '标记本题';

    // Sync exam submit button visibility
    const submitBtn = document.getElementById('qMoreSubmitExamBtn');
    if (submitBtn) {
      submitBtn.style.display = (mode === 'exam') ? 'flex' : 'none';
    }

    modal.style.display = 'flex';
  },

  closeQuestionMoreMenu(event) {
    if (event && event.target && event.target.id !== 'questionMoreModal' && !event.target.classList.contains('modal-close')) {
      return;
    }
    const modal = document.getElementById('questionMoreModal');
    if (modal) modal.style.display = 'none';
  },

  // ================== TOUCH GESTURES (MOBILE SWIPE) ==================
  bindTouchGestures() {
    const card = document.getElementById('questionCard');
    if (!card) return;

    let touchStartX = 0;
    let touchStartY = 0;

    card.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    card.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches.length === 1) {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;

        // Ensure horizontal swipe is dominant and above threshold (50px)
        if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
          if (diffX < 0) {
            // Swipe left -> Next question
            this.nextQuestion();
          } else {
            // Swipe right -> Prev question
            this.prevQuestion();
          }
        }
      }
    }, { passive: true });
  },

  // ================== GLOBAL KEYBOARD SHORTCUTS ==================
  bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.key === 'Escape') {
          this.closeDrawer();
          this.closeLanModal();
          this.closeMoreMenu();
          this.closeModeSelect();
          this.closeExamReportModal();
        }
        return;
      }

      if (e.key === 'Escape') {
        this.closeDrawer();
        this.closeLanModal();
        this.closeMoreMenu();
        this.closeModeSelect();
        this.closeExamReportModal();
        return;
      }

      if (this.state.currentView === 'practice') {
        const key = e.key.toUpperCase();

        if (['A', 'B', 'C', 'D'].includes(key)) {
          e.preventDefault();
          this.onOptionClick(key);
          return;
        }
        if (['1', '2', '3', '4'].includes(key)) {
          e.preventDefault();
          const map = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };
          this.onOptionClick(map[key]);
          return;
        }

        if (key === 'E') {
          e.preventDefault();
          this.toggleExplanationFold();
          return;
        }

        if (key === 'F') {
          e.preventDefault();
          this.toggleFlagCurrent();
          return;
        }

        if (key === 'M' || e.key === 'Tab') {
          e.preventDefault();
          const drawer = document.getElementById('questionDrawer');
          if (drawer.style.display === 'flex') {
            this.closeDrawer();
          } else {
            this.openDrawer();
          }
          return;
        }

        if (e.key === 'ArrowLeft' || key === 'J') {
          e.preventDefault();
          this.prevQuestion();
          return;
        }
        if (e.key === 'ArrowRight' || key === 'K') {
          e.preventDefault();
          this.nextQuestion();
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.nextQuestion();
          return;
        }
      }
    });
  }
};

// Global window attachment for HTML event handlers & devtools
window.DB = DB;
window.App = App;

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
