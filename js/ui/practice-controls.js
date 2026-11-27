/**
 * 刷题控制层 (js/ui/practice-controls.js)
 * 负责单题/总计计时器、移动端左右滑切题手势与桌面端全局盲打快捷键。
 */

export const practiceControlMethods = {
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
    if (!currentQ || isEvaluated || this.state.practiceMode === 'recite' || this.state.practiceMode === 'exam_review') {
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

  // ================== TOUCH GESTURES (MOBILE SWIPE) ==================
  bindTouchGestures() {
    const card = document.getElementById('questionCard');
    if (!card) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let isSingleTouch = false;

    card.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSingleTouch = true;
      } else {
        isSingleTouch = false;
      }
    }, { passive: true });

    card.addEventListener('touchcancel', () => {
      isSingleTouch = false;
    }, { passive: true });

    card.addEventListener('touchend', (e) => {
      if (!isSingleTouch) return;
      isSingleTouch = false;
      if (!this.state.questions || this.state.questions.length === 0) return;
      const sel = typeof window !== 'undefined' && typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (sel && sel.toString && sel.toString().trim().length > 0) return;

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
      if (!e.key || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      const tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.key === 'Escape') {
          this.closeAllModals();
        } else if (e.key === 'Tab') {
          const activeDialog = Array.from(document.querySelectorAll('.modal-backdrop, .drawer-backdrop')).find(el => el.classList.contains('is-open'));
          if (activeDialog && typeof this._trapFocusInActiveDialog === 'function') {
            this._trapFocusInActiveDialog(e, activeDialog);
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        const examReport = document.getElementById('examReportModal');
        if (examReport && examReport.classList.contains('is-open')) {
          this.closeExamReportModal();
        } else {
          this.closeAllModals();
        }
        return;
      }

      const activeModal = Array.from(document.querySelectorAll('.modal-backdrop')).find(el => el.classList.contains('is-open'));
      if (activeModal) {
        if (e.key === 'Tab' && typeof this._trapFocusInActiveDialog === 'function') {
          this._trapFocusInActiveDialog(e, activeModal);
        }
        return;
      }

      const key = e.key.toUpperCase();
      const activeDrawer = Array.from(document.querySelectorAll('.drawer-backdrop')).find(el => el.classList.contains('is-open'));
      if (activeDrawer) {
        if (key === 'M') {
          e.preventDefault();
          this.closeDrawer();
        } else if (e.key === 'Tab' && typeof this._trapFocusInActiveDialog === 'function') {
          this._trapFocusInActiveDialog(e, activeDrawer);
        }
        return;
      }

      if (this.state.currentView === 'practice') {
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
          this.openDrawer();
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
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
          if (activeEl && activeEl.classList && activeEl.classList.contains('option-item')) {
            const opts = Array.from(document.querySelectorAll('#qOptions .option-item'));
            const curIdx = opts.indexOf(activeEl);
            if (curIdx >= 0 && opts.length > 0) {
              e.preventDefault();
              const nextIdx = e.key === 'ArrowDown'
                ? (curIdx + 1) % opts.length
                : (curIdx - 1 + opts.length) % opts.length;
              opts[nextIdx].focus();
              return;
            }
          }
        }
        if (e.key === 'Enter' || e.key === ' ') {
          const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
          if (activeEl && activeEl.getAttribute && activeEl.getAttribute('data-action') === 'select-option') {
            const optKey = activeEl.getAttribute('data-key');
            if (optKey) {
              e.preventDefault();
              this.onOptionClick(optKey);
              return;
            }
          }
          const activeTag = activeEl && activeEl.tagName ? activeEl.tagName.toLowerCase() : '';
          const isInteractiveFocus = activeTag === 'button' || activeTag === 'a' || activeTag === 'summary'
            || (activeEl && typeof activeEl.getAttribute === 'function' && activeEl.getAttribute('role') === 'button');
          if (isInteractiveFocus) {
            return;
          }
          e.preventDefault();
          this.nextQuestion();
          return;
        }
      }
    });
  }
};
