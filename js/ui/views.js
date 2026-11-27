/**
 * 核心视图聚合与全站事件委托层 (js/ui/views.js)
 * 聚合 hub-view、practice-view、practice-controls、explanation-renderer、mistakes-view，
 * 并在 document 级统一代理所有静态/动态交互事件 (data-action / data-submit-action)，彻底消除内联 onclick/onsubmit。
 */
import { explanationMethods } from './explanation-renderer.js';
import { hubViewMethods } from './hub-view.js';
import { practiceViewMethods } from './practice-view.js';
import { practiceControlMethods } from './practice-controls.js';
import { mistakesViewMethods } from './mistakes-view.js';

export const viewMethods = {
  ...hubViewMethods,
  ...practiceViewMethods,
  ...practiceControlMethods,
  ...explanationMethods,
  ...mistakesViewMethods,

  _closeMenuIfNeeded(actionEl) {
    const closeMenu = actionEl.getAttribute('data-close-menu');
    if (closeMenu === 'more') this.closeMoreMenu();
    else if (closeMenu === 'user' && this.auth) this.auth.closeUserMenu();
  },

  /**
   * 全局视图与弹窗容器事件委托绑定
   */
  bindViewEvents() {
    if (this._viewEventsBound || typeof document === 'undefined') return;
    this._viewEventsBound = true;

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!target) return;

      // 1. 遮罩空白处点击自动关闭对应弹窗/抽屉
      if (target.classList && (target.classList.contains('modal-backdrop') || target.classList.contains('drawer-backdrop'))) {
        const id = target.id;
        if (id === 'examReportModal') this.closeExamReportModal(e);
        else if (id === 'confirmDialogModal') this.resolveConfirm(false, e);
        else if (id === 'authModal' && this.auth) this.auth.closeAuthModal(e);
        else if (id === 'adminModal' && this.auth) this.auth.closeAdminModal(e);
        else if (id) this.closeModal(id, e);
        return;
      }

      const actionEl = typeof target.closest === 'function' ? target.closest('[data-action]') : null;
      if (!actionEl) return;

      const action = actionEl.getAttribute('data-action');
      switch (action) {
        // ---- 动态视图交互 ----
        case 'switch-bank': {
          const bankId = actionEl.getAttribute('data-bank-id');
          if (bankId) this.switchQuestionBank(bankId);
          break;
        }
        case 'select-subject': {
          const idx = parseInt(actionEl.getAttribute('data-index'), 10);
          if (!Number.isNaN(idx)) this.selectSubjectTab(idx);
          break;
        }
        case 'start-practice': {
          const part = actionEl.getAttribute('data-part') || '';
          const chapter = actionEl.getAttribute('data-chapter') || '';
          const mode = actionEl.getAttribute('data-mode') || 'instant';
          this.startPractice(part, chapter, '', mode);
          break;
        }
        case 'reset-chapter': {
          const part = actionEl.getAttribute('data-part') || '';
          const chapter = actionEl.getAttribute('data-chapter') || '';
          this.resetChapter(part, chapter);
          break;
        }
        case 'select-option': {
          const key = actionEl.getAttribute('data-key');
          if (key) this.onOptionClick(key);
          break;
        }
        case 'jump-question': {
          const idx = parseInt(actionEl.getAttribute('data-index'), 10);
          if (!Number.isNaN(idx)) this.jumpToQuestion(idx);
          break;
        }
        case 'master-mistake': {
          const qid = actionEl.getAttribute('data-qid');
          if (qid) this.markMistakeMastered(qid);
          break;
        }
        case 'retry-mistake': {
          const qid = actionEl.getAttribute('data-qid');
          if (qid) this.retrySingleMistake(qid);
          break;
        }

        // ---- 导航与全局设置 ----
        case 'navigate': {
          const view = actionEl.getAttribute('data-view');
          if (view) this.navigateTo(view);
          break;
        }
        case 'toggle-theme':
          this.toggleTheme();
          break;
        case 'set-theme': {
          const theme = actionEl.getAttribute('data-theme-opt');
          if (theme) this.setTheme(theme);
          break;
        }
        case 'set-font-size': {
          const fontOpt = actionEl.getAttribute('data-font-opt');
          if (fontOpt) this.setFontSize(fontOpt);
          break;
        }
        case 'cycle-font-size':
          this.cycleFontSize();
          break;
        case 'reset-local-data':
          this._closeMenuIfNeeded(actionEl);
          this.resetLocalData();
          break;
        case 'trigger-pwa-install':
          this.triggerPwaInstall();
          break;

        // ---- 刷题区控制 ----
        case 'open-drawer':
          this._closeMenuIfNeeded(actionEl);
          this.openDrawer();
          break;
        case 'open-more-menu':
          this.openMoreMenu();
          break;
        case 'open-mode-select':
          this.openModeSelect();
          break;
        case 'select-mode-sheet': {
          const mode = actionEl.getAttribute('data-mode');
          if (mode) this.selectModeFromSheet(mode);
          break;
        }
        case 'switch-mode': {
          const mode = actionEl.getAttribute('data-mode');
          if (mode) this.switchMode(mode);
          this._closeMenuIfNeeded(actionEl);
          break;
        }
        case 'toggle-flag':
          this.toggleFlagCurrent();
          break;
        case 'toggle-explanation':
          this.toggleExplanationFold();
          break;
        case 'submit-multi':
          this.submitCurrentMultiChoice();
          break;
        case 'prev-question':
          this.prevQuestion();
          break;
        case 'next-question':
          this.nextQuestion();
          break;
        case 'submit-exam':
          this._closeMenuIfNeeded(actionEl);
          this.submitExam();
          break;
        case 'close-exam-report':
          this.closeExamReportModal();
          break;
        case 'review-exam':
          this.reviewExamQuestions();
          break;
        case 'start-mistakes-training':
          this._closeMenuIfNeeded(actionEl);
          this.startMistakesTraining();
          break;

        // ---- 统一弹窗关闭与 Confirm ----
        case 'close-modal-btn': {
          const modalId = actionEl.getAttribute('data-modal-id');
          if (modalId === 'examReportModal') this.closeExamReportModal();
          else if (modalId === 'authModal' && this.auth) this.auth.closeAuthModal();
          else if (modalId === 'adminModal' && this.auth) this.auth.closeAdminModal();
          else if (modalId === 'confirmDialogModal') this.resolveConfirm(false);
          else if (modalId) this.closeModal(modalId);
          break;
        }
        case 'confirm-resolve': {
          const ok = actionEl.getAttribute('data-confirm') === 'true';
          this.resolveConfirm(ok);
          break;
        }

        // ---- 账号与云同步 ----
        case 'auth-open': {
          this._closeMenuIfNeeded(actionEl);
          const tab = actionEl.getAttribute('data-tab') || 'login';
          if (this.auth) this.auth.openAuthModal(tab);
          break;
        }
        case 'auth-tab': {
          const tab = actionEl.getAttribute('data-tab');
          if (tab && this.auth) this.auth.switchTab(tab);
          break;
        }
        case 'auth-upload':
          if (this.auth) this.auth.uploadToCloud();
          this._closeMenuIfNeeded(actionEl);
          break;
        case 'auth-download':
          if (this.auth) this.auth.downloadFromCloud();
          this._closeMenuIfNeeded(actionEl);
          break;
        case 'auth-toggle-menu':
          if (this.auth) this.auth.toggleUserMenu(e);
          break;
        case 'auth-copy-username':
          if (this.auth) this.auth.copyUsername();
          break;
        case 'auth-logout':
          if (this.auth) this.auth.logout();
          this._closeMenuIfNeeded(actionEl);
          break;
        case 'auth-reset-local':
          this._closeMenuIfNeeded(actionEl);
          if (this.auth) this.auth.resetLocalData();
          break;
        case 'admin-open':
          if (this.auth) this.auth.openAdminModal();
          break;
        case 'admin-verify':
          if (this.auth) this.auth.verifyAdminSecret();
          break;
        case 'admin-clear-secret':
          if (this.auth) this.auth.clearSavedAdminSecret();
          break;
        case 'admin-copy-code':
          if (this.auth) this.auth.copyAdminGeneratedCode();
          break;
        default:
          break;
      }
    });

    document.addEventListener('change', (e) => {
      const target = e.target;
      if (!target || !target.getAttribute) return;
      const action = target.getAttribute('data-action');
      if (action === 'filter-part') {
        this.onPartFilterChange();
      } else if (action === 'filter-chapter') {
        this.onChapterFilterChange();
      }
    });

    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (!form || !form.getAttribute) return;
      const action = form.getAttribute('data-submit-action');
      if (!action || !this.auth) return;
      if (action === 'auth-login') this.auth.handleLogin(e);
      else if (action === 'auth-register') this.auth.handleRegister(e);
      else if (action === 'auth-reset') this.auth.handleResetPassword(e);
      else if (action === 'admin-generate') this.auth.handleAdminGenerateCode(e);
    });
  }
};
