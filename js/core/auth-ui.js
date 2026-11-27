/**
 * 用户认证弹窗、顶栏与移动端账号状态 UI 模块 (js/core/auth-ui.js)
 */
import { KY_CONFIG } from '../config.js';
import { KyApi } from '../api.js';
import { DB } from '../state/store.js';

function safeStorageSet(key, val) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(val));
  } catch (_) {}
}

function safeStorageRemove(key) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch (_) {}
}

export function createAuthUiMethods(getApp) {
  return {
    renderAuthUI() {
      const btnOpenAuth = document.getElementById('btnOpenAuth');
      const userLoggedInBlock = document.getElementById('userLoggedInBlock');
      const userNicknameDisplay = document.getElementById('userNicknameDisplay');
      const menuNickname = document.getElementById('menuNickname');
      const menuUsername = document.getElementById('menuUsername');
      const mUserNotLoggedIn = document.getElementById('mUserNotLoggedIn');
      const mUserLoggedIn = document.getElementById('mUserLoggedIn');
      const mUserNickname = document.getElementById('mUserNickname');
      const mUserAccount = document.getElementById('mUserAccount');

      if (this.currentUser) {
        const displayName = this.currentUser.nickname || this.currentUser.username;
        const accountTag = `@${this.currentUser.username}`;

        if (btnOpenAuth) btnOpenAuth.style.display = 'none';
        if (userLoggedInBlock) userLoggedInBlock.style.display = 'inline-flex';
        if (userNicknameDisplay) userNicknameDisplay.textContent = displayName;
        if (menuNickname) menuNickname.textContent = displayName;
        if (menuUsername) menuUsername.textContent = accountTag;

        if (mUserNotLoggedIn) mUserNotLoggedIn.style.display = 'none';
        if (mUserLoggedIn) mUserLoggedIn.style.display = 'flex';
        if (mUserNickname) mUserNickname.textContent = displayName;
        if (mUserAccount) mUserAccount.textContent = accountTag;
      } else {
        if (btnOpenAuth) btnOpenAuth.style.display = 'inline-block';
        if (userLoggedInBlock) userLoggedInBlock.style.display = 'none';

        if (mUserNotLoggedIn) mUserNotLoggedIn.style.display = 'flex';
        if (mUserLoggedIn) mUserLoggedIn.style.display = 'none';
      }

      this.updateSyncUI();
    },

    copyUsername() {
      const App = getApp();
      if (!this.currentUser || !this.currentUser.username) return;
      const uname = this.currentUser.username;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(uname).then(() => {
          App.showToast(`📋 已复制登录账号：${uname}`);
        }).catch(() => {
          App.showToast(`👤 当前登录账号：${uname}`);
        });
      } else {
        App.showToast(`👤 当前登录账号：${uname}`);
      }
    },

    updateSyncUI() {
      const desktopSyncIcon = document.getElementById('desktopSyncIcon');
      const desktopSyncText = document.getElementById('desktopSyncText');
      const btnUploadCloud = document.getElementById('btnUploadCloud') || document.getElementById('btnSyncCloud');
      const menuSyncTime = document.getElementById('menuSyncTime');
      const mUserSyncStatus = document.getElementById('mUserSyncStatus');

      const mBtnUploadCloud = document.getElementById('mBtnUploadCloud');
      const mCloudUploadIcon = document.getElementById('mCloudUploadIcon');
      const mCloudUploadText = document.getElementById('mCloudUploadText');

      let timeStr = '未保存';
      if (this.lastSyncTime) {
        const d = new Date(this.lastSyncTime);
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        timeStr = `${m}-${day} ${h}:${min}`;
      }

      if (this.isSyncing) {
        const syncingLabel = this.retryStatusText || '保存中...';
        if (btnUploadCloud) {
          btnUploadCloud.classList.add('syncing');
          btnUploadCloud.classList.remove('dirty', 'network-weak');
        }
        if (desktopSyncIcon) desktopSyncIcon.textContent = '🔄';
        if (desktopSyncText) desktopSyncText.textContent = syncingLabel;

        if (mBtnUploadCloud) {
          mBtnUploadCloud.classList.add('syncing');
          mBtnUploadCloud.classList.remove('dirty', 'network-weak');
        }
        if (mCloudUploadIcon) mCloudUploadIcon.textContent = '🔄';
        if (mCloudUploadText) mCloudUploadText.textContent = syncingLabel;
        if (mUserSyncStatus) mUserSyncStatus.textContent = this.retryStatusText ? `正在重试同步 (${this.retryStatusText})...` : '正在保存至云端...';
      } else if (this.isNetworkWeak) {
        if (btnUploadCloud) {
          btnUploadCloud.classList.remove('syncing');
          btnUploadCloud.classList.add('dirty', 'network-weak');
        }
        if (desktopSyncIcon) desktopSyncIcon.textContent = '⚠️';
        if (desktopSyncText) desktopSyncText.textContent = '待同步 (网络弱)';

        if (mBtnUploadCloud) {
          mBtnUploadCloud.classList.remove('syncing');
          mBtnUploadCloud.classList.add('dirty', 'network-weak');
        }
        if (mCloudUploadIcon) mCloudUploadIcon.textContent = '⚠️';
        if (mCloudUploadText) mCloudUploadText.textContent = '待同步 (网络弱)';
        if (mUserSyncStatus) mUserSyncStatus.textContent = '网络较弱，答题已暂存本地 (点击补传)';
        if (menuSyncTime) menuSyncTime.textContent = `上次保存: ${timeStr} (⚠️ 弱网待同步)`;
      } else if (this.isDirty) {
        if (btnUploadCloud) {
          btnUploadCloud.classList.remove('syncing', 'network-weak');
          btnUploadCloud.classList.add('dirty');
        }
        if (desktopSyncIcon) desktopSyncIcon.textContent = '🟡';
        if (desktopSyncText) desktopSyncText.textContent = '保存云端';

        if (mBtnUploadCloud) {
          mBtnUploadCloud.classList.remove('syncing', 'network-weak');
          mBtnUploadCloud.classList.add('dirty');
        }
        if (mCloudUploadIcon) mCloudUploadIcon.textContent = '🟡';
        if (mCloudUploadText) mCloudUploadText.textContent = '保存云端';
        if (mUserSyncStatus) mUserSyncStatus.textContent = '本地有新答题，点击上传保存';
        if (menuSyncTime) menuSyncTime.textContent = `上次保存: ${timeStr} (有未上传)`;
      } else {
        if (btnUploadCloud) {
          btnUploadCloud.classList.remove('syncing', 'dirty', 'network-weak');
        }
        if (desktopSyncIcon) desktopSyncIcon.textContent = '☁️';
        if (desktopSyncText) desktopSyncText.textContent = '已存云端';

        if (mBtnUploadCloud) {
          mBtnUploadCloud.classList.remove('syncing', 'dirty', 'network-weak');
        }
        if (mCloudUploadIcon) mCloudUploadIcon.textContent = '☁️';
        if (mCloudUploadText) mCloudUploadText.textContent = '上传云端';
        if (mUserSyncStatus) mUserSyncStatus.textContent = `云端已保存 (${timeStr})`;
        if (menuSyncTime) menuSyncTime.textContent = `上次保存: ${timeStr}`;
      }
    },

    toggleUserMenu(e) {
      if (e) e.stopPropagation();
      const menu = document.getElementById('userDropdownMenu');
      if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      }
    },

    closeUserMenu() {
      const menu = document.getElementById('userDropdownMenu');
      if (menu) menu.style.display = 'none';
    },

    openAuthModal(tab = 'login') {
      const App = getApp();
      this.closeUserMenu();
      this.switchTab(tab);
      if (App && typeof App.openModal === 'function') {
        App.openModal('authModal');
      } else {
        const modal = document.getElementById('authModal');
        if (modal) modal.classList.add('is-open');
      }
    },

    closeAuthModal(e) {
      const App = getApp();
      if (App && typeof App.closeModal === 'function') {
        if (App.closeModal('authModal', e)) {
          this.showNotice('', 'none');
        }
        return;
      }
      if (e && e.target && e.target !== e.currentTarget) return;
      const modal = document.getElementById('authModal');
      if (modal) modal.classList.remove('is-open');
      this.showNotice('', 'none');
    },

    switchTab(tab) {
      this.showNotice('', 'none');
      const tabs = ['login', 'register', 'reset'];
      tabs.forEach(t => {
        const btn = document.getElementById(`authTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
        const form = document.getElementById(`form${t.charAt(0).toUpperCase() + t.slice(1)}`);
        if (btn) btn.classList.toggle('active', t === tab);
        if (form) form.style.display = t === tab ? 'block' : 'none';
      });

      const titleEl = document.getElementById('authModalTitle');
      if (titleEl) {
        if (tab === 'login') titleEl.textContent = '考研政治 · 用户登录';
        else if (tab === 'register') titleEl.textContent = '考研政治 · 新用户注册';
        else if (tab === 'reset') titleEl.textContent = '考研政治 · 重置密码';
      }
    },

    showNotice(msg, type = 'error') {
      const notice = document.getElementById('authNotice');
      if (!notice) return;
      if (!msg) {
        notice.style.display = 'none';
        return;
      }
      notice.textContent = msg;
      notice.className = `auth-notice ${type}`;
      notice.style.display = 'block';
    },

    async handleLogin(e) {
      e.preventDefault();
      const App = getApp();
      const username = (document.getElementById('loginUsername').value || '').trim();
      const password = document.getElementById('loginPassword').value || '';
      const submitBtn = document.getElementById('btnLoginSubmit');

      if (!username || !password) {
        this.showNotice('请输入账号与密码', 'error');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = '登录中...';
        this.showNotice('', 'none');

        const res = await KyApi.fetchWithRetry(
          this.getApiUrl('/api/auth/login'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          },
          { maxRetries: 0, timeoutMs: KY_CONFIG.SYNC.TIMEOUT_MS }
        );

        const parsed = await KyApi.parseResponse(res);
        const data = parsed.data;
        if (!parsed.ok || !data.user) {
          throw new Error(parsed.error || data.error || '登录失败，请检查账号密码');
        }

        this.setSession(data.token, data.user);
        this.closeAuthModal();

        // 先清除旧账号各题库同步元信息与非当前题库进度，但不提前抹除当前题库本地进度；
        // 等云端明确拉取成功后，再原子覆盖当前本地缓存。
        this.purgeBankSyncMeta({ clearActiveProgress: false, clearOtherBanksProgress: true });
        this.lastSyncTime = null;
        this.isDirty = false;
        this.isNetworkWeak = false;
        safeStorageSet(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK, Date.now());

        let downloadOk = false;
        try {
          await this.downloadFromCloud(true, { forceFull: true, throwOnError: true });
          downloadOk = true;
        } catch (syncErr) {
          console.warn('[Login] Initial cloud hydration failed, preserving local data:', syncErr);
        }

        this.renderAuthUI();
        App.loadOverview();
        if (downloadOk) {
          App.showToast(`👋 欢迎回来，${data.user.nickname || data.user.username}！已载入您的云端学习进度`, 'success', 3600);
        } else {
          App.showToast(`👋 登录成功，但暂时无法拉取云端进度，已保留本机记录，可稍后点击同步`, 'warning', 4500);
        }
      } catch (err) {
        this.showNotice(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '立即登录并同步';
      }
    },

    async handleRegister(e) {
      e.preventDefault();
      const App = getApp();
      const username = (document.getElementById('regUsername').value || '').trim();
      const nickname = (document.getElementById('regNickname').value || '').trim();
      const password = document.getElementById('regPassword').value || '';
      const submitBtn = document.getElementById('btnRegSubmit');

      if (!username || !password) {
        this.showNotice('请填写完整的账号与密码', 'error');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = '注册中...';
        this.showNotice('', 'none');

        const res = await KyApi.fetchWithRetry(
          this.getApiUrl('/api/auth/register'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, nickname, password })
          },
          { maxRetries: 0, timeoutMs: KY_CONFIG.SYNC.TIMEOUT_MS }
        );

        const parsed = await KyApi.parseResponse(res);
        const data = parsed.data;
        if (!parsed.ok || !data.user) {
          throw new Error(parsed.error || data.error || '注册失败');
        }

        this.setSession(data.token, data.user);
        this.closeAuthModal();

        this.purgeBankSyncMeta({ clearActiveProgress: true, clearOtherBanksProgress: true });
        const keys = this.getActiveSyncKeys();
        const serverTs = Number.isFinite(data.updatedAt) && data.updatedAt > 0 ? data.updatedAt : Date.now();
        DB.setFromCloud({ answers: {}, mistakes: {}, version: 1, updatedAt: serverTs });
        this.lastSyncTime = serverTs;
        safeStorageSet(keys.LAST_SYNC_TIME, this.lastSyncTime);
        safeStorageSet(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK, Date.now());
        safeStorageSet(keys.LAST_UPLOAD_HASH, this.computeDataFingerprint(DB.toCompact()));
        this.isDirty = false;
        this.isNetworkWeak = false;
        this.updateSyncUI();
        App.loadOverview();
        App.showToast('🎉 注册成功！已自动登录，新账号初始进度为 0，开始刷题吧！', 'success', 3600);
      } catch (err) {
        this.showNotice(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '立即注册';
      }
    },

    async handleResetPassword(e) {
      e.preventDefault();
      const App = getApp();
      const username = (document.getElementById('resetUsername').value || '').trim();
      const code = (document.getElementById('resetCode').value || '').trim();
      const newPassword = document.getElementById('resetNewPassword').value || '';
      const submitBtn = document.getElementById('btnResetSubmit');

      if (!username || !code || !newPassword) {
        this.showNotice('请填写账号、6位重置码与新密码', 'error');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = '重置中...';
        this.showNotice('', 'none');

        const res = await KyApi.fetchWithRetry(
          this.getApiUrl('/api/auth/reset-password'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, code, newPassword })
          },
          { maxRetries: 0, timeoutMs: KY_CONFIG.SYNC.TIMEOUT_MS }
        );

        const parsed = await KyApi.parseResponse(res);
        const data = parsed.data;
        if (!parsed.ok || !data.user) {
          throw new Error(parsed.error || data.error || '重置密码失败');
        }

        this.setSession(data.token, data.user);
        this.closeAuthModal();

        this.purgeBankSyncMeta({ clearActiveProgress: false, clearOtherBanksProgress: true });
        this.lastSyncTime = null;
        this.isDirty = false;
        this.isNetworkWeak = false;
        safeStorageSet(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK, Date.now());

        let downloadOk = false;
        try {
          await this.downloadFromCloud(true, { forceFull: true, throwOnError: true });
          downloadOk = true;
        } catch (syncErr) {
          console.warn('[ResetPassword] Initial cloud hydration failed, preserving local data:', syncErr);
        }

        this.renderAuthUI();
        App.loadOverview();
        if (downloadOk) {
          App.showToast('✅ 密码重置成功！已自动登录并载入云端学习记录', 'success', 3600);
        } else {
          App.showToast('✅ 密码重置成功，但暂时无法拉取云端进度，已保留本机记录', 'warning', 4500);
        }
      } catch (err) {
        this.showNotice(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '确认重置并自动登录';
      }
    }
  };
}
