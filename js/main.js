/**
 * 前端原生 ES Modules 主入口 (js/main.js)
 * 组装状态层 (store)、同步层 (sync)、视图层 (views) 与弹窗层 (modals)，
 * 并向 window.App / window.DB 暴露全局桥接以兼容 index.html 内联事件。
 */
import { KY_CONFIG } from './config.js';
import { KyApi } from './api.js';
import { DB } from './state/store.js';
import { createAuthController } from './core/sync.js';
import { viewMethods } from './ui/views.js';
import { modalMethods } from './ui/modals.js';

export const App = {
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
    manualPeek: false,
    examDraftAnswers: {},
    isSingleMistakeRetry: false,

    questionSeconds: 0,
    sessionSeconds: 0,
    questionTimerTimer: null,
    sessionTimerTimer: null,

    mistakesList: [],
    filterPart: '',
    filterChapter: '',
    fontSize: 'md',
    theme: 'dark'
  },

  async init() {
    try {
      this.initTheme();
      this.initFontSize();
      this.bindViewEvents();
      this.startSessionTimer();
      this.bindGlobalKeys();
      this.bindTouchGestures();
      this.initPwaInstall();
      this.registerServiceWorker();
      await DB.init();
      this.auth.init();
      this.loadOverview();
    } catch (err) {
      console.error('[App.init] Error during initialization:', err);
    }
  },

  ...modalMethods,
  ...viewMethods
};

App.auth = createAuthController(() => App);

if (typeof globalThis !== 'undefined') {
  globalThis.KY_CONFIG = KY_CONFIG;
  globalThis.KyApi = KyApi;
  globalThis.DB = DB;
  globalThis.App = App;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      App.init();
    });
  } else {
    App.init();
  }
}

export { DB, KY_CONFIG, KyApi };
