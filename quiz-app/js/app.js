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
    } catch (e) {
      console.error('Failed to save user data to localStorage:', e);
    }
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
    await DB.init();
    this.loadOverview();
    this.initLanUrl();
  },

  // ================== TIMERS ==================
  startSessionTimer() {
    this.state.sessionTimerTimer = setInterval(() => {
      this.state.sessionSeconds++;
      const h = Math.floor(this.state.sessionSeconds / 3600);
      const m = Math.floor((this.state.sessionSeconds % 3600) / 60);
      const s = this.state.sessionSeconds % 60;
      const el = document.getElementById('sessionTimer');
      if (el) {
        el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }
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
    const el = document.getElementById('questionTimer');
    if (!el) return;
    const m = Math.floor(this.state.questionSeconds / 60);
    const s = this.state.questionSeconds % 60;
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  // ================== NAVIGATION ==================
  navigateTo(viewName) {
    this.state.currentView = viewName;
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

    if (viewName === 'hub') {
      document.getElementById('viewHub').classList.add('active');
      document.getElementById('navHubBtn').classList.add('active');
      this.loadOverview();
    } else if (viewName === 'practice') {
      document.getElementById('viewPractice').classList.add('active');
      document.getElementById('navPracticeBtn').classList.add('active');
      if (!this.state.questions.length) {
        this.startPractice('第一部分 马克思主义基本原理', '导论', '', 'instant');
      } else {
        this.renderQuestion();
      }
    } else if (viewName === 'mistakes') {
      document.getElementById('viewMistakes').classList.add('active');
      document.getElementById('navMistakesBtn').classList.add('active');
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

    const shortSub = part.replace(/^第[一二三四五]部分\s*/, '');
    document.getElementById('crumbSubject').textContent = `${shortSub} · ${chapter}`;

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
    document.getElementById('modeBtnInstant').classList.toggle('active', mode === 'instant');
    document.getElementById('modeBtnExam').classList.toggle('active', mode === 'exam');
    document.getElementById('modeBtnRecite').classList.toggle('active', mode === 'recite');

    const modeTag = document.getElementById('pModeTag');
    modeTag.style.display = mode === 'mistakes_only' ? 'inline-block' : 'none';

    const btnExam = document.getElementById('btnExamSubmit');
    const drawerExam = document.getElementById('drawerExamSubmitBtn');
    if (btnExam) btnExam.style.display = (mode === 'exam') ? 'inline-flex' : 'none';
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

    const shortSub = q.part.replace(/^第[一二三四五]部分\s*/, '');
    document.getElementById('pSubjectTag').textContent = shortSub;
    document.getElementById('pChapterTag').textContent = q.chapter;

    const typeTag = document.getElementById('pTypeTag');
    typeTag.textContent = q.type;
    typeTag.className = `p-type-tag ${q.type === '单项选择题' ? 'type-single' : 'type-multi'}`;

    document.getElementById('pCurrentNum').textContent = this.state.currentIndex + 1;
    document.getElementById('pTotalNum').textContent = this.state.questions.length;
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
    if (this.state.isFlagged) {
      flagBtn.classList.add('active');
      flagIcon.textContent = '★';
    } else {
      flagBtn.classList.remove('active');
      flagIcon.textContent = '☆';
    }

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

  prevQuestion() {
    if (this.state.currentIndex > 0) {
      this.state.currentIndex--;
      this.renderQuestion();
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
      this.state.currentIndex = index;
      this.renderQuestion();
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
    if (this.state.isFlagged) {
      flagBtn.classList.add('active');
      flagIcon.textContent = '★';
    } else {
      flagBtn.classList.remove('active');
      flagIcon.textContent = '☆';
    }
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

  populateMistakeFilters() {
    if (!this.state.overview) return;
    const pSelect = document.getElementById('mPartFilter');
    if (pSelect.children.length <= 1) {
      pSelect.innerHTML = '<option value="">全部科目</option>' +
        this.state.overview.subjects.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    }
  },

  filterMistakes() {
    this.state.filterPart = document.getElementById('mPartFilter').value;
    this.loadMistakes();
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
            <span class="p-subject-tag">${m.part.replace(/^第[一二三四五]部分\s*/, '')}</span>
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
            <button class="btn-primary" style="font-size:12px; padding: 6px 14px;" onclick="App.startPractice('${m.part}', '${m.chapter}', '', 'instant')">
              ⚡ 重刷这道题
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  markMistakeMastered(qid) {
    DB.mistakeAction(qid, 'master');
    this.loadMistakes();
    this.loadOverview();
  },

  startMistakesTraining() {
    if (!this.state.mistakesList.length) {
      alert('当前没有错题可以特训！');
      return;
    }
    const firstM = this.state.mistakesList[0];
    this.startPractice(firstM.part, firstM.chapter, '', 'mistakes_only');
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

  // ================== GLOBAL KEYBOARD SHORTCUTS ==================
  bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.key === 'Escape') {
          this.closeDrawer();
          this.closeLanModal();
          this.closeExamReportModal();
        }
        return;
      }

      if (e.key === 'Escape') {
        this.closeDrawer();
        this.closeLanModal();
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

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
