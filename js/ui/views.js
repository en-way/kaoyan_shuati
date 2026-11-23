/**
 * 核心视图渲染与刷题交互层 (js/ui/views.js)
 * 负责题库大厅、多题库/年份切换器、刷题主界面、答题卡抽屉、模考成绩单、错题本、计时器与快捷键。
 */
import { DB } from '../state/store.js';

export const viewMethods = {
  // ================== 多题库/年份动态切换 UI ==================
  renderBankSelector() {
    const meta = DB.getBankMeta(DB.currentBankId);
    const yearBadge = document.getElementById('brandYearBadge');
    if (yearBadge && meta && meta.year) {
      yearBadge.textContent = String(meta.year);
    }

    const wrap = document.getElementById('bankSelectorWrap');
    if (!wrap) return;

    const banks = (DB.catalog && Array.isArray(DB.catalog.banks)) ? DB.catalog.banks : [];
    if (banks.length <= 1) {
      // 单题库时保持顶部简洁不突兀
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }

    wrap.style.display = 'inline-flex';
    const optionsHtml = banks.map(b => {
      const sel = b.id === DB.currentBankId ? 'selected' : '';
      const label = b.shortTitle || `${b.year}版1000题`;
      return `<option value="${b.id}" ${sel}>${label}</option>`;
    }).join('');

    wrap.innerHTML = `
      <select id="bankSelectorSelect" class="bank-selector-select"
              onchange="App.switchQuestionBank(this.value)"
              title="切换不同年份/专项题库（进度独立保存）"
              style="background:rgba(255,255,255,0.08);color:var(--text-primary);border:1px solid rgba(255,255,255,0.16);border-radius:8px;padding:4px 8px;font-size:12px;cursor:pointer;margin-left:8px;">
        ${optionsHtml}
      </select>
    `;
  },

  async switchQuestionBank(targetBankId) {
    if (!targetBankId || targetBankId === DB.currentBankId) return;

    // 切换前若当前已登录且当前题库有未同步进度，静默触发一次后台保存
    if (this.auth && this.auth.token && this.auth.isDirty && !this.auth.isSyncing) {
      try {
        await this.auth.uploadToCloud(true);
      } catch (_) {}
    }

    const ok = await DB.switchBank(targetBankId);
    if (!ok) {
      this.renderBankSelector();
      return;
    }

    this.state.activeSubjectIndex = 0;
    this.state.questions = [];
    this.state.currentIndex = 0;
    this.state.filterPart = '';
    this.state.filterChapter = '';

    if (this.auth && typeof this.auth.refreshBankSyncState === 'function') {
      this.auth.refreshBankSyncState(DB.currentBankId);
    }

    this.renderBankSelector();
    this.navigateTo('hub');
    const meta = DB.getBankMeta(DB.currentBankId);
    this.showToast(`📚 已切换至「${meta.title || meta.id}」`, 'success');
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
      const sideExamTimer = document.getElementById('sideExamTimer');
      if (sideExamTimer) sideExamTimer.textContent = formatted;
    }, 1000);
  },

  resetQuestionTimer() {
    if (this.state.questionTimerTimer) {
      clearInterval(this.state.questionTimerTimer);
      this.state.questionTimerTimer = null;
    }
    const currentQ = this.getCurrentQuestion();
    this.state.questionSeconds = currentQ ? (currentQ.user_time || 0) : 0;
    this.updateQuestionTimerDisplay();

    const isEvaluated = currentQ && (currentQ.is_correct !== null && currentQ.is_correct !== undefined);
    if (!currentQ || isEvaluated || this.state.practiceMode === 'recite') {
      return;
    }

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
  updateBreadcrumb(text) {
    const crumbEl = document.getElementById('crumbSubject');
    if (crumbEl && text) {
      crumbEl.textContent = text;
      crumbEl.setAttribute('title', text);
    }
  },

  navigateTo(viewName) {
    if (viewName !== 'practice' && this.state.questionTimerTimer) {
      clearInterval(this.state.questionTimerTimer);
      this.state.questionTimerTimer = null;
    }
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
      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else if (viewName === 'practice') {
      document.getElementById('viewPractice').classList.add('active');
      document.getElementById('navPracticeBtn').classList.add('active');
      const mBtn = document.getElementById('mNavPracticeBtn');
      if (mBtn) mBtn.classList.add('active');
      if (!this.state.questions.length) {
        const firstSub = (this.state.overview && this.state.overview.subjects && this.state.overview.subjects[0]);
        const defaultPart = firstSub ? firstSub.name : '第一部分 马克思主义基本原理';
        const defaultCh = (firstSub && firstSub.chapters && firstSub.chapters[0]) ? firstSub.chapters[0].name : '导论';
        this.startPractice(defaultPart, defaultCh, '', 'instant');
      } else {
        const currentQ = this.getCurrentQuestion();
        if (currentQ) {
          const shortSub = this.getSubjectShortName(currentQ.part);
          this.updateBreadcrumb(`${shortSub} · ${currentQ.chapter}`);
        }
        this.renderQuestion();
      }
    } else if (viewName === 'mistakes') {
      document.getElementById('viewMistakes').classList.add('active');
      document.getElementById('navMistakesBtn').classList.add('active');
      const mBtn = document.getElementById('mNavMistakesBtn');
      if (mBtn) mBtn.classList.add('active');
      this.updateBreadcrumb('错题攻坚集');
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

    if (this.state.currentView === 'hub' && data.subjects && data.subjects[this.state.activeSubjectIndex]) {
      const curSub = data.subjects[this.state.activeSubjectIndex];
      this.updateBreadcrumb(this.getSubjectShortName(curSub.name) || curSub.name);
    }

    this.renderBankSelector();
    this.renderSubjectTabs();
    this.renderChaptersGrid();
  },

  renderSubjectTabs() {
    const container = document.getElementById('subjectTabsContainer');
    if (!container || !this.state.overview) return;

    container.innerHTML = this.state.overview.subjects.map((sub, idx) => {
      const active = idx === this.state.activeSubjectIndex ? 'active' : '';
      const fullName = sub.name.replace(/^第[一二三四五]部分\s*/, '');
      const shortName = this.getSubjectShortName(sub.name);
      return `
        <button class="subject-tab ${active}" onclick="App.selectSubjectTab(${idx})" title="${fullName} (${sub.answered}/${sub.total})">
          <span class="sub-tab-name-full">${fullName}</span>
          <span class="sub-tab-name-short">${shortName}</span>
          <span class="sub-tab-count">(${sub.answered}/${sub.total})</span>
        </button>
      `;
    }).join('');
  },

  selectSubjectTab(idx) {
    this.state.activeSubjectIndex = idx;
    if (this.state.overview && this.state.overview.subjects && this.state.overview.subjects[idx]) {
      const sub = this.state.overview.subjects[idx];
      this.updateBreadcrumb(this.getSubjectShortName(sub.name) || sub.name);
    }
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
    if (this.state.currentPart === part && this.state.currentChapter === chapter) {
      this.state.questions = [];
      this.state.currentIndex = 0;
    }
    this.loadOverview();
  },

  // ================== VIEW 2: PRACTICE STREAM ==================
  startPractice(part, chapter, type = '', mode = 'instant', resumeQid = null) {
    this.state.currentPart = part;
    this.state.currentChapter = chapter;
    this.state.currentType = type;
    this.state.practiceMode = mode;
    this.state.explanationVisible = true;

    const shortSub = part ? this.getSubjectShortName(part) : '全科错题';
    const chTitle = chapter || (mode === 'mistakes_only' ? '专项特训' : '全部章节');
    this.updateBreadcrumb(`${shortSub} · ${chTitle}`);

    const data = DB.getQuestions(part, chapter, type, mode);
    this.state.questions = data.questions || [];

    if (resumeQid && this.state.questions.length > 0) {
      const foundIdx = this.state.questions.findIndex(q => q.id === resumeQid);
      this.state.currentIndex = foundIdx >= 0 ? foundIdx : 0;
    } else if ((mode === 'instant' || mode === 'recite') && this.state.questions.length > 0) {
      const firstUnansweredIdx = this.state.questions.findIndex(
        q => !q.user_selected || q.user_selected.length === 0
      );

      if (firstUnansweredIdx > 0) {
        this.state.currentIndex = firstUnansweredIdx;
        if (typeof this.showToast === 'function') {
          this.showToast(`📍 已自动定位至未刷题目：第 ${firstUnansweredIdx + 1} 题`, 'info');
        }
      } else if (firstUnansweredIdx === -1) {
        this.state.currentIndex = 0;
        if (typeof this.showToast === 'function') {
          this.showToast('🎉 本章题目已全部刷完，从第 1 题开始复习', 'success');
        }
      } else {
        this.state.currentIndex = 0;
      }
    } else {
      this.state.currentIndex = 0;
    }

    this.navigateTo('practice');
    this.updateModePillsUI();
    this.renderQuestion();
  },

  switchMode(newMode) {
    if (this.state.practiceMode === newMode) return;
    const currentQ = this.state.questions && this.state.questions[this.state.currentIndex];
    const resumeQid = currentQ ? currentQ.id : null;

    this.state.practiceMode = newMode;
    this.updateModePillsUI();
    this.startPractice(this.state.currentPart, this.state.currentChapter, this.state.currentType, newMode, resumeQid);
  },

  updateModePillsUI() {
    const mode = this.state.practiceMode;
    const btnInstant = document.getElementById('modeBtnInstant');
    const btnExam = document.getElementById('modeBtnExam');
    const btnRecite = document.getElementById('modeBtnRecite');
    if (btnInstant) btnInstant.classList.toggle('active', mode === 'instant');
    if (btnExam) btnExam.classList.toggle('active', mode === 'exam');
    if (btnRecite) btnRecite.classList.toggle('active', mode === 'recite');

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

    ['Instant', 'Exam', 'Recite'].forEach(k => {
      const opt = document.getElementById(`mModeOption${k}`);
      if (opt) opt.classList.toggle('active', mode === k.toLowerCase());
    });

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
    const bottomBar = document.querySelector('.practice-bottom-bar');
    if (bottomBar) bottomBar.classList.toggle('exam-mode-active', mode === 'exam');
  },

  getCurrentQuestion() {
    return this.state.questions[this.state.currentIndex];
  },

  renderQuestion() {
    const q = this.getCurrentQuestion();
    const card = document.getElementById('questionCard');
    if (!q) {
      if (card) {
        const stem = document.getElementById('qStem');
        if (stem) stem.textContent = '此分类下暂无题目。';
        const opts = document.getElementById('qOptions');
        if (opts) opts.innerHTML = '';
        const subItems = document.getElementById('qSubItems');
        if (subItems) subItems.style.display = 'none';
        const multiBar = document.getElementById('multiSubmitBar');
        if (multiBar) multiBar.style.display = 'none';
        const panel = document.getElementById('explanationPanel');
        if (panel) panel.style.display = 'none';
        const qNumBadge = document.getElementById('qNumberBadge');
        if (qNumBadge) qNumBadge.textContent = '—';
        const tagEl = document.getElementById('qSpecialTag');
        if (tagEl) tagEl.style.display = 'none';
        const pCurrent = document.getElementById('pCurrentNum');
        if (pCurrent) pCurrent.textContent = '0';
        const pTotal = document.getElementById('pTotalNum');
        if (pTotal) pTotal.textContent = '0';
        const mProgress = document.getElementById('mCardProgress');
        if (mProgress) mProgress.textContent = '0/0';
      }
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

    let isVisible = false;
    if (mode === 'recite') {
      isVisible = this.state.explanationVisible;
    } else if (mode === 'instant' || mode === 'mistakes_only') {
      if (this.state.isEvaluated) {
        isVisible = this.state.explanationVisible;
      } else {
        isVisible = !!this.state.manualPeek;
      }
    }

    if (panel) {
      if (!isVisible) {
        panel.style.display = 'none';
      } else {
        panel.style.display = 'flex';
        const explAns = document.getElementById('explAnswerVal');
        if (explAns) explAns.textContent = q.answer || '—';

        const srcWrap = document.getElementById('explSourceWrap');
        if (q.source) {
          if (srcWrap) srcWrap.style.display = 'flex';
          const srcText = document.getElementById('explSourceText');
          if (srcText) srcText.textContent = q.source;
        } else if (srcWrap) {
          srcWrap.style.display = 'none';
        }

        const analysisText = document.getElementById('explAnalysisText');
        if (analysisText) analysisText.textContent = q.analysis || '暂无解析';

        const tipsWrap = document.getElementById('explTipsWrap');
        if (q.tips) {
          if (tipsWrap) tipsWrap.style.display = 'flex';
          const tipsText = document.getElementById('explTipsText');
          if (tipsText) tipsText.textContent = q.tips;
        } else if (tipsWrap) {
          tipsWrap.style.display = 'none';
        }
      }
    }

    this.renderSideExplanationPanel(q, isVisible);
  },

  renderSideExplanationPanel(q, isVisible) {
    const sidePanel = document.getElementById('desktopSidePanel');
    if (!sidePanel) return;

    const mode = this.state.practiceMode;
    const placeholder = document.getElementById('sideExplPlaceholder');
    const active = document.getElementById('sideExplActive');
    const exam = document.getElementById('sideExamCard');

    if (!q) {
      if (placeholder) placeholder.style.display = 'flex';
      if (active) active.style.display = 'none';
      if (exam) exam.style.display = 'none';
      return;
    }

    if (mode === 'exam') {
      if (placeholder) placeholder.style.display = 'none';
      if (active) active.style.display = 'none';
      if (exam) {
        exam.style.display = 'flex';
        const curNumEl = document.getElementById('sideExamCurNum');
        if (curNumEl) curNumEl.textContent = `${this.state.currentIndex + 1} / ${this.state.questions.length}`;
        const answeredCount = this.state.questions.filter(item => item.user_selected && item.user_selected.length > 0).length;
        const countEl = document.getElementById('sideExamAnsweredCount');
        if (countEl) countEl.textContent = `${answeredCount} 题`;
      }
      return;
    }

    if (exam) exam.style.display = 'none';

    if (isVisible) {
      if (placeholder) placeholder.style.display = 'none';
      if (active) {
        active.style.display = 'flex';
        const sideAnsVal = document.getElementById('sideExplAnswerVal');
        if (sideAnsVal) sideAnsVal.textContent = q.answer || '—';

        const sideSrcWrap = document.getElementById('sideExplSourceWrap');
        if (q.source) {
          if (sideSrcWrap) sideSrcWrap.style.display = 'flex';
          const sideSrcText = document.getElementById('sideExplSourceText');
          if (sideSrcText) sideSrcText.textContent = q.source;
        } else if (sideSrcWrap) {
          sideSrcWrap.style.display = 'none';
        }

        const banner = document.getElementById('sideResultBanner');
        const resIcon = document.getElementById('sideResultIcon');
        const resText = document.getElementById('sideResultText');
        if (banner) {
          if (this.state.isEvaluated && q.is_correct !== null && q.is_correct !== undefined) {
            banner.style.display = 'flex';
            if (q.is_correct) {
              banner.className = 'side-result-banner is-correct';
              if (resIcon) resIcon.textContent = '✓';
              if (resText) resText.textContent = `回答正确！你的选择: ${(q.user_selected || []).join('')}`;
            } else {
              banner.className = 'side-result-banner is-wrong';
              if (resIcon) resIcon.textContent = '✗';
              const selStr = (q.user_selected || []).join('') || '未作答';
              if (resText) resText.textContent = `回答错误。你的选择: ${selStr}，标准答案: ${q.answer}`;
            }
          } else {
            banner.style.display = 'none';
          }
        }

        const sideAnalysisText = document.getElementById('sideExplAnalysisText');
        if (sideAnalysisText) sideAnalysisText.textContent = q.analysis || '暂无解析';

        const sideTipsWrap = document.getElementById('sideExplTipsWrap');
        if (q.tips) {
          if (sideTipsWrap) sideTipsWrap.style.display = 'flex';
          const sideTipsText = document.getElementById('sideExplTipsText');
          if (sideTipsText) sideTipsText.textContent = q.tips;
        } else if (sideTipsWrap) {
          sideTipsWrap.style.display = 'none';
        }

        const sideFlagIcon = document.getElementById('sideFlagIcon');
        if (sideFlagIcon) sideFlagIcon.textContent = this.state.isFlagged ? '★' : '☆';
      }
    } else {
      if (active) active.style.display = 'none';
      if (placeholder) placeholder.style.display = 'flex';
    }
  },

  toggleExplanationFold() {
    const mode = this.state.practiceMode;
    if (this.state.isEvaluated || mode === 'recite') {
      this.state.explanationVisible = !this.state.explanationVisible;
    } else {
      this.state.manualPeek = !this.state.manualPeek;
    }
    const q = this.getCurrentQuestion();
    if (q) this.renderExplanationPanel(q);
  },

  // ================== ANSWERING INTERACTIONS ==================
  onOptionClick(key) {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const mode = this.state.practiceMode;

    if (mode === 'recite') return;
    if ((mode === 'instant' || mode === 'mistakes_only') && this.state.isEvaluated) return;

    if (q.type === '单项选择题') {
      this.state.selectedOptions = [key];
      q.user_selected = [key];
      q.user_time = this.state.questionSeconds;

      if (mode === 'instant' || mode === 'mistakes_only') {
        this.submitAnswerNow(true);
      } else if (mode === 'exam') {
        this.submitAnswerNow(false);
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
      } else {
        this.renderQuestion();
      }
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
      if (this.state.questionTimerTimer) {
        clearInterval(this.state.questionTimerTimer);
        this.state.questionTimerTimer = null;
      }
    }
    this.renderQuestion();
  },

  animateCard(direction = 'left') {
    const card = document.getElementById('questionCard');
    if (!card) return;
    card.classList.remove('anim-slide-left', 'anim-slide-right');
    void card.offsetWidth;
    card.classList.add(direction === 'left' ? 'anim-slide-left' : 'anim-slide-right');
  },

  prevQuestion() {
    if (this.state.currentIndex > 0) {
      this.state.manualPeek = false;
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
      this.state.manualPeek = false;
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
      this.state.manualPeek = false;
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

    const sideFlagIcon = document.getElementById('sideFlagIcon');
    if (sideFlagIcon) sideFlagIcon.textContent = this.state.isFlagged ? '★' : '☆';

    this.updateDrawerIfOpen();
  },

  // ================== EXAM SUBMISSION ==================
  submitExam() {
    if (!confirm('确定要提交本次模考交卷吗？系统将立即统一批改并生成成绩单。')) {
      return;
    }
    if (this.state.questionTimerTimer) {
      clearInterval(this.state.questionTimerTimer);
      this.state.questionTimerTimer = null;
    }

    const data = DB.submitExam(this.state.currentPart, this.state.currentChapter);

    const accEl = document.getElementById('examReportAccuracy');
    if (accEl) accEl.textContent = `${data.score_rate}%`;
    const scorePointsEl = document.getElementById('examScorePoints');
    if (scorePointsEl) scorePointsEl.textContent = `${data.earned_points} / ${data.total_points} 分`;
    const totEl = document.getElementById('examTotalQ');
    if (totEl) totEl.textContent = data.total;
    const corrEl = document.getElementById('examCorrectQ');
    if (corrEl) corrEl.textContent = data.correct_count;
    const wrgEl = document.getElementById('examWrongQ');
    if (wrgEl) wrgEl.textContent = data.wrong_count;
    const unEl = document.getElementById('examUnansweredQ');
    if (unEl) unEl.textContent = data.unanswered_count;

    const listContainer = document.getElementById('examReportList');
    if (listContainer) {
      listContainer.innerHTML = data.results.map(r => {
        const rowClass = r.is_correct ? 'row-correct' : 'row-wrong';
        const icon = r.is_correct ? '<span style="color:var(--accent-green)">✓</span>' : '<span style="color:var(--accent-coral)">✗</span>';
        const scoreTag = r.is_correct
          ? `<strong style="color:var(--accent-green);font-size:12px;margin-left:6px;">+${r.score_earned}分</strong>`
          : `<span style="color:var(--accent-coral);font-size:12px;margin-left:6px;">+0分</span>`;
        return `
          <div class="report-row ${rowClass}">
            <span>${icon} <strong>第 ${r.num} 题</strong> (${r.type} ${r.max_score}分) ${scoreTag}</span>
            <span>你的选择: <code>${r.user_ans}</code></span>
            <span>正确答案: <strong style="color:var(--accent-green)">${r.standard_ans}</strong></span>
          </div>
        `;
      }).join('');
    }

    document.getElementById('examReportModal').style.display = 'flex';
    this.closeDrawer();
    this.updateBodyScrollLock();
  },

  closeExamReportModal(event) {
    if (event && event.target && event.target.id !== 'examReportModal' && !event.target.classList.contains('modal-close') && !event.target.classList.contains('btn-secondary')) {
      return;
    }
    const modal = document.getElementById('examReportModal');
    if (modal) modal.style.display = 'none';
    this.updateBodyScrollLock();
    this.navigateTo('hub');
  },

  reviewExamQuestions() {
    const modal = document.getElementById('examReportModal');
    if (modal) modal.style.display = 'none';
    this.updateBodyScrollLock();
    this.startPractice(this.state.currentPart, this.state.currentChapter, '', 'instant');
  },

  // ================== QUESTION PALETTE & DRAWER ==================
  generatePaletteGridHtml() {
    const mode = this.state.practiceMode;

    return this.state.questions.map((q, idx) => {
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
        <button class="grid-q-btn ${stateClass}" onclick="App.jumpToQuestion(${idx})" title="第 ${q.num} 题">
          ${q.num}
        </button>
      `;
    }).join('');
  },

  updateDrawerIfOpen() {
    const drawer = document.getElementById('questionDrawer');
    if (drawer && drawer.style.display === 'flex') {
      const drawerContainer = document.getElementById('drawerGridContainer');
      if (drawerContainer) {
        drawerContainer.innerHTML = this.generatePaletteGridHtml();
      }
    }
  },

  openDrawer() {
    const container = document.getElementById('drawerGridContainer');
    if (!container) return;

    container.innerHTML = this.generatePaletteGridHtml();

    const drawer = document.getElementById('questionDrawer');
    if (drawer) {
      drawer.style.display = 'flex';
      this.updateBodyScrollLock();
      requestAnimationFrame(() => {
        const curBtn = container.querySelector('.grid-q-btn.current');
        if (curBtn && typeof curBtn.scrollIntoView === 'function') {
          curBtn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        }
      });
    }
  },

  closeDrawer(event) {
    if (event && event.target && event.target.id !== 'questionDrawer' && !event.target.classList.contains('drawer-close')) {
      return;
    }
    const drawer = document.getElementById('questionDrawer');
    if (drawer) drawer.style.display = 'none';
    this.updateBodyScrollLock();
  },

  // ================== VIEW 3: MISTAKES VAULT ==================
  loadMistakes() {
    const part = this.state.filterPart;
    const chapter = this.state.filterChapter;
    const data = DB.getMistakes(part, chapter);
    this.state.mistakesList = data.mistakes || [];

    const totalMistakesCount = DB.getMistakes('', '').count;
    const mCountEl = document.getElementById('mMistakesCountText');
    if (mCountEl) mCountEl.textContent = `共 ${data.count} 道待攻克错题`;

    const globalBadge = document.getElementById('globalMistakeBadge');
    if (globalBadge) globalBadge.textContent = totalMistakesCount;
    const mGlobalBadge = document.getElementById('mGlobalMistakeBadge');
    if (mGlobalBadge) mGlobalBadge.textContent = totalMistakesCount;

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
    const allMistakesData = DB.getMistakes('', '');
    const allList = allMistakesData.mistakes || [];
    const totalAllCount = allList.length;

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

    this.populateMistakeChapterOptions(statsByPart, totalAllCount);
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
    this.updateBreadcrumb(`${shortSub} · 错题精练`);

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

  // ================== LOCAL DATA RESET ==================
  resetLocalData() {
    this.auth.resetLocalData();
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

        if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
          if (diffX < 0) {
            this.nextQuestion();
          } else {
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
          this.closeMoreMenu();
          this.closeModeSelect();
          this.closeQuestionMoreMenu();
          this.closeExamReportModal();
        }
        return;
      }

      if (e.key === 'Escape') {
        this.closeDrawer();
        this.closeMoreMenu();
        this.closeModeSelect();
        this.closeQuestionMoreMenu();
        this.closeExamReportModal();
        if (this.auth && typeof this.auth.closeAuthModal === 'function') this.auth.closeAuthModal();
        if (this.auth && typeof this.auth.closeAdminModal === 'function') this.auth.closeAdminModal();
        return;
      }

      const anyBackdrop = Array.from(document.querySelectorAll('.modal-backdrop, .drawer-backdrop')).find(el => {
        return el.style.display && el.style.display !== 'none';
      });
      if (anyBackdrop) {
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
