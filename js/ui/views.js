/**
 * 核心视图聚合与事件委托层 (js/ui/views.js)
 * 聚合 hub-view、practice-view、explanation-renderer、mistakes-view，
 * 并统一在视图容器级绑定 data-action 事件委托，消除动态模板字符串中的内联 onclick/onchange。
 */
import { explanationMethods } from './explanation-renderer.js';
import { hubViewMethods } from './hub-view.js';
import { practiceViewMethods } from './practice-view.js';
import { mistakesViewMethods } from './mistakes-view.js';

export const viewMethods = {
  ...hubViewMethods,
  ...practiceViewMethods,
  ...explanationMethods,
  ...mistakesViewMethods,

  /**
   * 视图容器级事件委托绑定（在大厅、刷题流、错题本、答题卡抽屉上统一代理 data-action）
   */
  bindViewEvents() {
    if (this._viewEventsBound || typeof document === 'undefined') return;
    this._viewEventsBound = true;

    document.addEventListener('click', (e) => {
      const actionEl = e.target && typeof e.target.closest === 'function'
        ? e.target.closest('[data-action]')
        : null;
      if (!actionEl) return;

      const action = actionEl.getAttribute('data-action');
      switch (action) {
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
        default:
          break;
      }
    });

    document.addEventListener('change', (e) => {
      const target = e.target;
      if (!target) return;
      const action = target.getAttribute && target.getAttribute('data-action');
      if (action === 'filter-part') {
        this.onPartFilterChange();
      } else if (action === 'filter-chapter') {
        this.onChapterFilterChange();
      }
    });
  }
};
