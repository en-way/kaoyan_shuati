/**
 * 弹窗、设置、字号控制、本地备份导入导出与 PWA 安装交互层 (js/ui/modals.js)
 */
import { KY_CONFIG } from '../config.js';
import { DB } from '../state/store.js';

export const modalMethods = {
  // ================== 双主题（柔和暗黑 + 浅色护眼纸感）切换与持久化引擎 ==================
  initTheme() {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem(KY_CONFIG.STORAGE_KEYS.THEME)) || 'dark';
    this.setTheme(saved, true);
  },

  setTheme(theme, silent = false) {
    const target = theme === 'light' ? 'light' : 'dark';
    this.state.theme = target;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KY_CONFIG.STORAGE_KEYS.THEME, target);
    }

    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', target);
      if (document.body) {
        document.body.setAttribute('data-theme', target);
        document.body.classList.toggle('theme-light', target === 'light');
        document.body.classList.toggle('theme-dark', target === 'dark');
      }

      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute('content', target === 'light' ? '#f4f3ee' : '#0b111e');
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
    const saved = localStorage.getItem(KY_CONFIG.STORAGE_KEYS.FONT_SIZE) || 'md';
    this.setFontSize(saved, true);
  },

  setFontSize(size, silent = false) {
    const validSizes = ['sm', 'md', 'lg', 'xl'];
    const target = validSizes.includes(size) ? size : 'md';
    this.state.fontSize = target;
    localStorage.setItem(KY_CONFIG.STORAGE_KEYS.FONT_SIZE, target);

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
    const modal = document.getElementById('moreMenuModal');
    if (modal) modal.style.display = 'flex';
    this.updateBodyScrollLock();
  },

  closeMoreMenu(event) {
    if (event && event.target && event.target.id !== 'moreMenuModal' && !event.target.classList.contains('modal-close')) {
      return;
    }
    const modal = document.getElementById('moreMenuModal');
    if (modal) modal.style.display = 'none';
    this.updateBodyScrollLock();
  },

  // ================== MOBILE MODE SELECTOR ==================
  openModeSelect() {
    const modal = document.getElementById('modeSelectModal');
    if (modal) modal.style.display = 'flex';
    this.updateBodyScrollLock();
  },

  closeModeSelect(event) {
    if (event && event.target && event.target.id !== 'modeSelectModal' && !event.target.classList.contains('modal-close')) {
      return;
    }
    const modal = document.getElementById('modeSelectModal');
    if (modal) modal.style.display = 'none';
    this.updateBodyScrollLock();
  },

  selectModeFromSheet(mode) {
    this.closeModeSelect();
    this.switchMode(mode);
  },

  // ================== MOBILE QUESTION MORE MENU ==================
  openQuestionMoreMenu() {
    const modal = document.getElementById('questionMoreModal');
    if (!modal) return;

    const mode = this.state.practiceMode;
    ['Instant', 'Exam', 'Recite', 'Mistakes'].forEach(k => {
      const btn = document.getElementById(`qMoreMode${k}`);
      if (btn) {
        const isAct = k.toLowerCase() === mode || (k === 'Mistakes' && mode === 'mistakes_only');
        btn.classList.toggle('active', isAct);
      }
    });

    const qMoreIcon = document.getElementById('qMoreFlagIcon');
    const qMoreTitle = document.getElementById('qMoreFlagTitle');
    if (qMoreIcon) qMoreIcon.textContent = this.state.isFlagged ? '★' : '☆';
    if (qMoreTitle) qMoreTitle.textContent = this.state.isFlagged ? '已标记本题 (点击取消)' : '标记本题';

    const submitBtn = document.getElementById('qMoreSubmitExamBtn');
    if (submitBtn) {
      submitBtn.style.display = (mode === 'exam') ? 'flex' : 'none';
    }

    modal.style.display = 'flex';
    this.updateBodyScrollLock();
  },

  closeQuestionMoreMenu(event) {
    if (event && event.target && event.target.id !== 'questionMoreModal' && !event.target.classList.contains('modal-close')) {
      return;
    }
    const modal = document.getElementById('questionMoreModal');
    if (modal) modal.style.display = 'none';
    this.updateBodyScrollLock();
  },

  updateBodyScrollLock() {
    const modalIds = [
      'authModal',
      'adminModal',
      'moreMenuModal',
      'modeSelectModal',
      'questionMoreModal',
      'questionDrawer',
      'examReportModal'
    ];
    const isAnyOpen = modalIds.some(id => {
      const el = document.getElementById(id);
      return el && el.style.display && el.style.display !== 'none';
    });
    if (document.body) {
      document.body.classList.toggle('modal-open', isAnyOpen);
    }
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
      alert('🎉 恭喜！应用已成功添加到手机桌面，后续可直接从桌面全屏启动刷题！');
    });
  },

  async triggerPwaInstall() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) {
      alert('💡 应用当前已经在手机桌面 App 独立全屏模式中运行！');
      return;
    }

    const ua = navigator.userAgent.toLowerCase();
    const isWeChat = /micromessenger/.test(ua);
    const isQQ = /qq\//.test(ua);
    if (isWeChat || isQQ) {
      alert('⚠️ 微信/QQ 内置浏览器受安全限制无法直接添加到桌面。\n\n请点击右上角「⋯」，选择「在浏览器打开」（如 Safari 或 Chrome），即可一键下载到手机桌面！');
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
      alert('🍎 iPhone / iPad 添加到桌面只需 2 步：\n\n1. 点击 Safari 底部中间的【分享 📤】按钮\n2. 在弹出菜单中下滑找到并点击【添加到主屏幕 ➕】\n\n即可直接在手机桌面生成专属 App 图标！');
    } else {
      alert('📱 添加到手机桌面方式：\n\n请点击浏览器右上角菜单【⋮】，在菜单中选择【安装应用】或【添加到主屏幕】，即可直接下载到桌面！');
    }
  },

  registerServiceWorker() {
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      const doRegister = () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
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
          refreshing = true;
          window.location.reload();
        }
      });
    }
  }
};
