/**
 * 沉浸式刷题视图层 (js/ui/practice-view.js)
 * 负责做题主界面、做题模式切换、选项判题、答题卡抽屉、模考交卷成绩单、计时器与快捷键/手势。
 */
import { DB } from '../state/store.js';

export const practiceViewMethods = {
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
        <div class="option-item ${extraClass}" data-action="select-option" data-key="${opt.key}">
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
      this.showToast('⚠️ 请先至少勾选一个选项后再提交！', 'warning', 2600);
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
        this.showToast('🎉 恭喜！你已完成本章节的所有题目！', 'success', 3200);
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

    this.closeDrawer();
    this.openModal('examReportModal');
  },

  closeExamReportModal(event) {
    if (this.closeModal('examReportModal', event)) {
      this.navigateTo('hub');
    }
  },

  reviewExamQuestions() {
    this.closeModal('examReportModal');
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
        <button type="button" class="grid-q-btn ${stateClass}" data-action="jump-question" data-index="${idx}" title="第 ${q.num} 题">
          ${q.num}
        </button>
      `;
    }).join('');
  },

  updateDrawerIfOpen() {
    const drawer = document.getElementById('questionDrawer');
    if (drawer && drawer.classList.contains('is-open')) {
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
    this.openModal('questionDrawer');

    requestAnimationFrame(() => {
      const curBtn = container.querySelector('.grid-q-btn.current');
      if (curBtn && typeof curBtn.scrollIntoView === 'function') {
        curBtn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      }
    });
  },

  closeDrawer(event) {
    this.closeModal('questionDrawer', event);
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
          this.closeAllModals();
        }
        return;
      }

      if (e.key === 'Escape') {
        this.closeAllModals();
        return;
      }

      const anyBackdrop = Array.from(document.querySelectorAll('.modal-backdrop, .drawer-backdrop')).find(el => {
        return el.classList.contains('is-open');
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
          if (drawer && drawer.classList.contains('is-open')) {
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
