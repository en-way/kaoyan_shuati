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
