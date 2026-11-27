/**
 * 弹窗、设置、字号控制、双主题切换、本地备份导入导出与 PWA 安装交互层 (js/ui/modals.js)
 * 统一通过 .is-open 类名管理弹窗与抽屉显隐状态及滚动穿透锁定，消除硬编码弹窗 ID 列表。
 */
import { KY_CONFIG } from '../config.js';
import { DB } from '../state/store.js';

export const modalMethods = {
  _lastFocusedEl: null,

  _getFocusableElements(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return [];
    const selector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(selector)).filter((node) => {
      if (node.closest && node.closest('[hidden]')) return false;
      const style = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
        ? window.getComputedStyle(node)
        : null;
      return !style || (style.display !== 'none' && style.visibility !== 'hidden');
    });
  },

  _trapFocusInActiveDialog(e, dialogBackdrop) {
    if (!e || e.key !== 'Tab' || !dialogBackdrop) return;
    const focusables = this._getFocusableElements(dialogBackdrop);
    if (focusables.length === 0) {
      e.preventDefault();
      if (typeof dialogBackdrop.focus === 'function') dialogBackdrop.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (e.shiftKey) {
      if (!active || active === first || !dialogBackdrop.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (!active || active === last || !dialogBackdrop.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  },

  _restoreFocusAfterDialog() {
    if (typeof document === 'undefined') return;
    const anyStillOpen = Array.from(document.querySelectorAll('.modal-backdrop, .drawer-backdrop')).some(node => node.classList.contains('is-open'));
    if (anyStillOpen) return;
    const prev = this._lastFocusedEl;
    this._lastFocusedEl = null;
    if (prev && typeof prev.focus === 'function' && prev.isConnected !== false) {
      try { prev.focus(); } catch (_) {}
    }
  },

  // ================== 统一弹窗/抽屉控制器 (.is-open + 滚动锁管理) ==================
  openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (typeof document !== 'undefined' && document.activeElement && !this._lastFocusedEl) {
      const cur = document.activeElement;
      if (cur !== document.body && cur !== document.documentElement) {
        this._lastFocusedEl = cur;
      }
    }
    el.classList.add('is-open');
    this.updateBodyScrollLock();

    const focusFirst = () => {
      if (!el.classList.contains('is-open')) return;
      const focusables = this._getFocusableElements(el);
      const target = el.querySelector('input:not([disabled]):not([type="hidden"])') || focusables[0] || el;
      if (target && typeof target.focus === 'function') {
        if (!target.hasAttribute('tabindex') && target === el) {
          el.setAttribute('tabindex', '-1');
        }
        try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (__) {} }
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(focusFirst);
    } else {
      focusFirst();
    }
  },

  closeModal(id, event) {
    if (event && event.target) {
      const isBackdropClick = event.target.id === id;
      const isCloseBtn = typeof event.target.closest === 'function'
        ? Boolean(event.target.closest('.modal-close, .drawer-close, .btn-secondary'))
        : (event.target.classList.contains('modal-close') || event.target.classList.contains('drawer-close') || event.target.classList.contains('btn-secondary'));
      if (!isBackdropClick && !isCloseBtn) {
        return false;
      }
    }
    const el = document.getElementById(id);
    if (!el) return false;
    el.classList.remove('is-open');
    this.updateBodyScrollLock();
    this._restoreFocusAfterDialog();
    return true;
  },

  closeAllModals() {
    if (typeof document === 'undefined') return;
    const examReport = document.getElementById('examReportModal');
    const wasExamReportOpen = Boolean(examReport && examReport.classList.contains('is-open'));
    document.querySelectorAll('.modal-backdrop, .drawer-backdrop').forEach(el => {
      el.classList.remove('is-open');
    });
    if (typeof this.resolveConfirm === 'function') {
      this.resolveConfirm(false);
    }
    if (this.auth && typeof this.auth.showNotice === 'function') {
      this.auth.showNotice('', 'none');
    }
    this.updateBodyScrollLock();
    this._restoreFocusAfterDialog();
    if (wasExamReportOpen && typeof this.navigateTo === 'function') {
      this.navigateTo('hub');
    }
  },

  _confirmResolver: null,

  /**
   * 全局统一自定义确认弹窗（替代浏览器原生阻塞 confirm()）
   * @returns {Promise<boolean>}
   */
  showConfirm({
    title = '操作确认',
    message = '',
    confirmText = '确认',
    cancelText = '取消',
    danger = false
  } = {}) {
    if (typeof document === 'undefined') return Promise.resolve(true);
    const modal = document.getElementById('confirmDialogModal');
    const titleEl = document.getElementById('confirmDialogTitle');
    const msgEl = document.getElementById('confirmDialogMessage');
    const cancelBtn = document.getElementById('confirmDialogCancelBtn');
    const okBtn = document.getElementById('confirmDialogOkBtn');

    if (!modal || !okBtn) {
      return Promise.resolve(true);
    }

    if (this._confirmResolver) {
      const prev = this._confirmResolver;
      this._confirmResolver = null;
      prev(false);
    }

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (cancelBtn) cancelBtn.textContent = cancelText;
    okBtn.textContent = confirmText;
    okBtn.className = danger ? 'btn-danger' : 'btn-primary';

    return new Promise((resolve) => {
      this._confirmResolver = resolve;
      this.openModal('confirmDialogModal');
    });
  },

  resolveConfirm(result = false, event = null) {
    if (event && event.target) {
      const isBackdrop = event.target.id === 'confirmDialogModal';
      const isCloseBtn = typeof event.target.closest === 'function'
        ? Boolean(event.target.closest('.modal-close, #confirmDialogCancelBtn'))
        : (event.target.classList.contains('modal-close') || event.target.id === 'confirmDialogCancelBtn');
      const isOkBtn = event.target.id === 'confirmDialogOkBtn';
      if (!isBackdrop && !isCloseBtn && !isOkBtn) return false;
    }
    const modal = document.getElementById('confirmDialogModal');
    if (modal) modal.classList.remove('is-open');
    this.updateBodyScrollLock();
    const resolver = this._confirmResolver;
    this._confirmResolver = null;
    if (typeof resolver === 'function') {
      resolver(Boolean(result));
    }
    return true;
  },

  updateBodyScrollLock() {
    if (typeof document === 'undefined') return;
    const isAnyOpen = Array.from(document.querySelectorAll('.modal-backdrop, .drawer-backdrop')).some(el => {
      return el.classList.contains('is-open');
    });
    if (document.body) {
      document.body.classList.toggle('modal-open', isAnyOpen);
    }
  },

  // ================== 双主题（柔和暗黑 + 浅色护眼纸感）切换与持久化引擎 ==================
  initTheme() {
    let saved = 'dark';
    try {
      if (typeof localStorage !== 'undefined') {
        saved = localStorage.getItem(KY_CONFIG.STORAGE_KEYS.THEME) || 'dark';
      }
    } catch (_) {}
    this.setTheme(saved, true);
  },

  setTheme(theme, silent = false) {
    const target = theme === 'light' ? 'light' : 'dark';
    this.state.theme = target;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(KY_CONFIG.STORAGE_KEYS.THEME, target);
      }
    } catch (_) {}

    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', target);
      if (document.body) {
        document.body.setAttribute('data-theme', target);
        document.body.classList.toggle('theme-light', target === 'light');
        document.body.classList.toggle('theme-dark', target === 'dark');
      }

      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute('content', target === 'light' ? '#f6f4ef' : '#0c1017');
      }

      const iconEl = document.getElementById('themeToggleIcon');
      const textEl = document.getElementById('themeToggleText');
      if (iconEl) iconEl.textContent = target === 'light' ? '🌙' : '☀️';
      if (textEl) textEl.textContent = target === 'light' ? '暗黑' : '护眼';

      const curLabel = target === 'light' ? '浅色护眼 (纸感)' : '柔和暗黑 (默认)';
      document.querySelectorAll('.m-theme-cur-label').forEach(el => {
        el.textContent = curLabel;
      });

      document.querySelectorAll('.theme-seg-btn').forEach(btn => {
        const opt = btn.getAttribute('data-theme-opt');
        btn.classList.toggle('active', opt === target);
      });
    }

    if (!silent && typeof this.showToast === 'function') {
      this.showToast(target === 'light' ? '☀️ 已切换为「浅色护眼纸感」主题' : '🌙 已切换为「柔和暗黑」主题');
    }
  },

  toggleTheme() {
    const next = this.state.theme === 'light' ? 'dark' : 'light';
    this.setTheme(next, false);
  },

  // ================== 四档阅读字号自适应与记忆引擎 ==================
  initFontSize() {
    let saved = 'md';
    try {
      if (typeof localStorage !== 'undefined') {
        saved = localStorage.getItem(KY_CONFIG.STORAGE_KEYS.FONT_SIZE) || 'md';
      }
    } catch (_) {}
    this.setFontSize(saved, true);
  },

  setFontSize(size, silent = false) {
    const validSizes = ['sm', 'md', 'lg', 'xl'];
    const target = validSizes.includes(size) ? size : 'md';
    this.state.fontSize = target;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(KY_CONFIG.STORAGE_KEYS.FONT_SIZE, target);
      }
    } catch (_) {}

    document.documentElement.setAttribute('data-font-size', target);
    if (document.body) {
      document.body.setAttribute('data-font-size', target);
    }

    const labelMap = {
      sm: { short: '小号', full: '小号 (紧凑)' },
      md: { short: '标准', full: '标准 (默认)' },
      lg: { short: '大字', full: '大字 (舒适)' },
      xl: { short: '特大', full: '特大 (护眼)' }
    };
    const info = labelMap[target] || labelMap.md;

    const pLabel = document.getElementById('pFontSizeLabel');
    if (pLabel) pLabel.textContent = info.short;

    document.querySelectorAll('.m-font-size-cur-label').forEach(el => {
      el.textContent = info.full;
    });

    document.querySelectorAll('.font-seg-btn').forEach(btn => {
      const opt = btn.getAttribute('data-font-opt');
      btn.classList.toggle('active', opt === target);
    });

    if (!silent && typeof this.showToast === 'function') {
      this.showToast(`🔤 已切换为「${info.full}」字号`);
    }
  },

  cycleFontSize() {
    const order = ['md', 'lg', 'xl', 'sm'];
    const idx = order.indexOf(this.state.fontSize || 'md');
    const next = order[(idx + 1) % order.length];
    this.setFontSize(next, false);
  },

  // 轻量级非阻塞 Toast 提示组件
  showToast(message, type = 'info', duration = 3000) {
    let container = document.getElementById('appToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'appToastContainer';
      container.className = 'app-toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `app-toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, duration);
  },

  // ================== 本地 JSON 备份导出与导入 ==================
  exportProgress() {
    const payload = DB.exportBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kaoyan_backup_${payload.bankId}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('📦 已导出当前题库学习记录备份 JSON', 'success');
  },

  importProgress(rawJsonText) {
    const res = DB.importBackupPayload(rawJsonText, DB.currentBankId);
    if (!res.success) {
      this.showToast(`❌ 导入失败: ${res.error}`, 'error');
      return res;
    }
    this.loadOverview();
    this.showToast(`✅ 成功导入 ${res.answeredCount} 条作答与 ${res.mistakesCount} 条错题记录`, 'success');
    return res;
  },

  // ================== MOBILE MORE MENU ==================
  openMoreMenu() {
    this.openModal('moreMenuModal');
  },

  closeMoreMenu(event) {
    this.closeModal('moreMenuModal', event);
  },

  // ================== MOBILE MODE SELECTOR ==================
  openModeSelect() {
    this.openModal('modeSelectModal');
  },

  closeModeSelect(event) {
    this.closeModal('modeSelectModal', event);
  },

  selectModeFromSheet(mode) {
    this.closeModeSelect();
    this.switchMode(mode);
  },

  // ================== PWA & SERVICE WORKER ==================
  deferredInstallPrompt: null,

  initPwaInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      const btn = document.getElementById('btnPwaInstall');
      if (btn) btn.style.display = 'flex';
      console.log('[PWA] beforeinstallprompt captured, ready to install.');
    });

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      console.log('[PWA] App successfully installed to desktop/home screen.');
      this.showToast('🎉 应用已成功添加到手机桌面，后续可直接从主屏幕全屏启动！', 'success', 4500);
    });
  },

  async triggerPwaInstall() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) {
      this.showToast('💡 应用当前已经在手机桌面 App 独立全屏模式中运行！', 'info', 3500);
      return;
    }

    const ua = navigator.userAgent.toLowerCase();
    const isWeChat = /micromessenger/.test(ua);
    const isQQ = /qq\//.test(ua);
    if (isWeChat || isQQ) {
      this.showToast('⚠️ 微信/QQ 内置浏览器受限，请点击右上角「⋯」选择「在浏览器打开」以添加到桌面', 'warning', 5000);
      return;
    }

    if (this.deferredInstallPrompt) {
      this.deferredInstallPrompt.prompt();
      const choiceResult = await this.deferredInstallPrompt.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        console.log('[PWA] User accepted the install prompt');
        this.deferredInstallPrompt = null;
      } else {
        console.log('[PWA] User dismissed the install prompt');
      }
      return;
    }

    const isIOS = /iphone|ipad|ipod/.test(ua);
    if (isIOS) {
      this.showToast('🍎 iPhone/iPad：请点击 Safari 底部「分享 📤」-> 选择「添加到主屏幕 ➕」', 'info', 5200);
    } else {
      this.showToast('📱 请点击浏览器右上角菜单「⋮」-> 选择「安装应用 / 添加到主屏幕」', 'info', 4800);
    }
  },

  registerServiceWorker() {
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      const doRegister = () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
          .then((reg) => {
            console.log('[PWA] Service Worker registered with scope:', reg.scope);
            reg.update().catch(() => {});
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
      };

      if (document.readyState === 'complete') {
        doRegister();
      } else {
        window.addEventListener('load', doRegister);
      }

      const hadPreviousController = !!navigator.serviceWorker.controller;
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing && hadPreviousController) {
          const isActiveExam = this.state.currentView === 'practice' && this.state.practiceMode === 'exam'
            && this.state.examDraftAnswers && Object.keys(this.state.examDraftAnswers).length > 0;
          const isUnsubmittedMulti = this.state.currentView === 'practice'
            && (this.state.practiceMode === 'instant' || this.state.practiceMode === 'mistakes_only')
            && this.state.selectedOptions && this.state.selectedOptions.length > 0 && !this.state.isEvaluated;
          if (isActiveExam || isUnsubmittedMulti) {
            this.state.pendingSwReload = true;
            if (typeof this.showToast === 'function') {
              this.showToast('🆕 发现新版本，交卷或返回大厅后将自动更新生效', 'info', 4000);
            }
            return;
          }
          refreshing = true;
          window.location.reload();
        }
      });
    }
  }
};
