/**
 * 云端认证与多题库同步调度层 (js/core/sync.js)
 * - 绑定当前激活的 bankId 进行上传/下载与按题库脏状态跟踪
 * - 指纹防抖拦截：内容未变时不发起冗余请求，节约 Cloudflare D1 写入配额
 * - 乐观锁 version 冲突处理：收到 HTTP 409 时自动在本地按时间戳合并云端最新数据并重试
 */
import { KY_CONFIG } from '../config.js';
import { KyApi } from '../api.js';
import { DB } from '../state/store.js';

export function createAuthController(getApp) {
  return {
    currentUser: null,
    token: (typeof localStorage !== 'undefined' && localStorage.getItem(KY_CONFIG.STORAGE_KEYS.TOKEN)) || null,
    isDirty: false,
    lastSyncTime: null,
    isSyncing: false,
    isNetworkWeak: false,
    retryStatusText: '',
    _lastAdminResult: null,

    fetchWithRetry(url, options = {}, maxRetries, timeoutMs, onRetry = null) {
      return KyApi.fetchWithRetry(url, options, { maxRetries, timeoutMs, onRetry });
    },

    getApiUrl(path) {
      return path;
    },

    getActiveSyncKeys(bankId = DB.currentBankId) {
      return DB.getActiveKeys(bankId);
    },

    refreshBankSyncState(bankId = DB.currentBankId) {
      const keys = this.getActiveSyncKeys(bankId);
      const rawTime = localStorage.getItem(keys.LAST_SYNC_TIME);
      this.lastSyncTime = rawTime ? parseInt(rawTime, 10) : null;

      try {
        const compactData = DB.toCompact(bankId);
        const currentHash = this.computeDataFingerprint(compactData);
        const lastUploadHash = localStorage.getItem(keys.LAST_UPLOAD_HASH);
        const isExplicitDirty = localStorage.getItem(keys.IS_DIRTY) === '1';
        this.isDirty = Boolean(isExplicitDirty || (lastUploadHash && currentHash !== lastUploadHash));
      } catch (e) {
        this.isDirty = false;
      }
      this.updateSyncUI();
    },

    init() {
      document.addEventListener('click', () => {
        this.closeUserMenu();
      });

      window.addEventListener('online', () => {
        console.log('[Network] Connection restored to online.');
        if (this.token && (this.isDirty || this.isNetworkWeak)) {
          this.uploadToCloud(true).catch(e => {
            console.warn('[Network] Auto-resume upload deferred:', e);
          });
        }
      });

      this.refreshBankSyncState(DB.currentBankId);

      if (this.token) {
        this.checkSession();
      } else {
        this.renderAuthUI();
      }
      this.updateSyncUI();
    },

    markDirty(bankId = DB.currentBankId) {
      const keys = this.getActiveSyncKeys(bankId);
      this.isDirty = true;
      localStorage.setItem(keys.IS_DIRTY, '1');
      this.updateSyncUI();
    },

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

        const res = await fetch(this.getApiUrl('/api/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '登录失败，请检查账号密码');
        }

        this.setSession(data.token, data.user);
        this.closeAuthModal();

        const keys = this.getActiveSyncKeys();
        this.lastSyncTime = null;
        localStorage.removeItem(keys.LAST_SYNC_TIME);
        localStorage.removeItem(keys.PROGRESS);
        if (keys.LEGACY_PROGRESS) localStorage.removeItem(keys.LEGACY_PROGRESS);

        localStorage.setItem(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK, String(Date.now()));
        await this.downloadFromCloud(true);
        this.renderAuthUI();
        App.loadOverview();
        alert(`欢迎回来，${data.user.nickname || data.user.username}！已为您清除本地临时数据，并成功载入您的专属云端进度。`);
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

        const res = await fetch(this.getApiUrl('/api/auth/register'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, nickname, password })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '注册失败');
        }

        this.setSession(data.token, data.user);
        this.closeAuthModal();

        const keys = this.getActiveSyncKeys();
        localStorage.removeItem(keys.PROGRESS);
        if (keys.LEGACY_PROGRESS) localStorage.removeItem(keys.LEGACY_PROGRESS);
        DB.setFromCloud({ answers: {}, mistakes: {}, version: 1, updatedAt: Date.now() });
        this.lastSyncTime = Date.now();
        localStorage.setItem(keys.LAST_SYNC_TIME, String(this.lastSyncTime));
        localStorage.setItem(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK, String(this.lastSyncTime));
        localStorage.setItem(keys.LAST_UPLOAD_HASH, this.computeDataFingerprint(DB.toCompact()));
        this.isDirty = false;
        this.updateSyncUI();
        App.loadOverview();
        alert('注册成功！已为您自动登录，新账号初始进度为 0，请开始学习！');
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

        const res = await fetch(this.getApiUrl('/api/auth/reset-password'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, code, newPassword })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '重置密码失败');
        }

        this.setSession(data.token, data.user);
        this.closeAuthModal();

        const keys = this.getActiveSyncKeys();
        this.lastSyncTime = null;
        localStorage.removeItem(keys.LAST_SYNC_TIME);
        localStorage.removeItem(keys.PROGRESS);
        if (keys.LEGACY_PROGRESS) localStorage.removeItem(keys.LEGACY_PROGRESS);
        localStorage.setItem(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK, String(Date.now()));
        await this.downloadFromCloud(true);
        this.renderAuthUI();
        App.loadOverview();
        alert('密码重置成功！已自动为您登录，并载入您的云端学习记录。');
      } catch (err) {
        this.showNotice(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '确认重置并自动登录';
      }
    },

    openAdminModal() {
      const App = getApp();
      this.closeAuthModal();
      const resultBox = document.getElementById('adminResultBox');
      const notice = document.getElementById('adminNotice');
      const secretInput = document.getElementById('adminSecretKey');
      const clearLink = document.getElementById('adminClearSecretLink');

      if (resultBox) resultBox.style.display = 'none';
      if (notice) notice.style.display = 'none';
      if (App && typeof App.openModal === 'function') {
        App.openModal('adminModal');
      } else {
        const modal = document.getElementById('adminModal');
        if (modal) modal.classList.add('is-open');
      }

      const savedSecret = localStorage.getItem('kaoyan_admin_secret_saved') || '';
      if (secretInput && savedSecret) {
        secretInput.value = savedSecret;
        if (clearLink) clearLink.style.display = 'inline';
      } else if (clearLink) {
        clearLink.style.display = 'none';
      }
    },

    closeAdminModal(e) {
      const App = getApp();
      if (App && typeof App.closeModal === 'function') {
        App.closeModal('adminModal', e);
        return;
      }
      if (e && e.target && e.target !== e.currentTarget) return;
      const modal = document.getElementById('adminModal');
      if (modal) modal.classList.remove('is-open');
    },

    async verifyAdminSecret() {
      const secretInput = document.getElementById('adminSecretKey');
      const notice = document.getElementById('adminNotice');
      const clearLink = document.getElementById('adminClearSecretLink');
      const secret = (secretInput ? secretInput.value : '').trim();

      if (!secret) {
        if (notice) {
          notice.textContent = '请先在上方输入需要测试的管理员密钥';
          notice.className = 'auth-notice error';
          notice.style.display = 'block';
        }
        if (secretInput) secretInput.focus();
        return;
      }

      try {
        if (notice) {
          notice.textContent = '正在与 Cloudflare 边缘服务器比对密钥...';
          notice.className = 'auth-notice';
          notice.style.display = 'block';
        }

        const res = await fetch(this.getApiUrl('/api/admin/verify-secret'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': secret
          },
          body: JSON.stringify({ adminSecret: secret })
        });

        const data = await res.json();
        if (!res.ok || !data.isValid) {
          throw new Error(data.error || '密钥校验失败');
        }

        localStorage.setItem('kaoyan_admin_secret_saved', secret);
        if (clearLink) clearLink.style.display = 'inline';

        if (notice) {
          notice.textContent = data.message || '✅ 密钥有效！';
          notice.className = data.isCustomConfigured ? 'auth-notice success' : 'auth-notice warning';
          notice.style.display = 'block';
        }
      } catch (err) {
        if (notice) {
          notice.textContent = `❌ ${err.message}`;
          notice.className = 'auth-notice error';
          notice.style.display = 'block';
        }
      }
    },

    clearSavedAdminSecret() {
      localStorage.removeItem('kaoyan_admin_secret_saved');
      const secretInput = document.getElementById('adminSecretKey');
      const clearLink = document.getElementById('adminClearSecretLink');
      const notice = document.getElementById('adminNotice');
      if (secretInput) secretInput.value = '';
      if (clearLink) clearLink.style.display = 'none';
      if (notice) {
        notice.textContent = '已清除本浏览器记住的管理员密钥';
        notice.className = 'auth-notice';
        notice.style.display = 'block';
      }
    },

    async handleAdminGenerateCode(e) {
      e.preventDefault();
      const adminSecret = (document.getElementById('adminSecretKey').value || '').trim();
      const username = (document.getElementById('adminTargetUsername').value || '').trim();
      const notice = document.getElementById('adminNotice');
      const resultBox = document.getElementById('adminResultBox');
      const codeDisplay = document.getElementById('adminGeneratedCode');
      const submitBtn = document.getElementById('btnAdminGenerate');
      const clearLink = document.getElementById('adminClearSecretLink');

      if (!adminSecret || !username) {
        notice.textContent = '请输入管理员密钥与学员账号';
        notice.className = 'auth-notice error';
        notice.style.display = 'block';
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = '生成中...';
        notice.style.display = 'none';

        const res = await fetch(this.getApiUrl('/api/admin/generate-reset-code'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': adminSecret
          },
          body: JSON.stringify({ adminSecret, username })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '生成重置码失败');
        }

        localStorage.setItem('kaoyan_admin_secret_saved', adminSecret);
        if (clearLink) clearLink.style.display = 'inline';

        codeDisplay.textContent = data.code;
        resultBox.style.display = 'block';
        notice.textContent = `学员「${data.nickname || data.username}」的 6 位重置码已生成！`;
        notice.className = 'auth-notice success';
        notice.style.display = 'block';

        this._lastAdminResult = {
          username: data.username,
          code: data.code,
          expiresIn: data.expiresInMinutes || 15
        };
      } catch (err) {
        notice.textContent = err.message;
        notice.className = 'auth-notice error';
        notice.style.display = 'block';
        resultBox.style.display = 'none';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '⚡ 生成 6 位重置验证码';
      }
    },

    copyAdminGeneratedCode() {
      if (!this._lastAdminResult) return;
      const text = `【考研政治 1000 题】学员 ${this._lastAdminResult.username}，您的密码重置码为：${this._lastAdminResult.code}，请在 ${this._lastAdminResult.expiresIn} 分钟内点击登录界面的「忘记密码」输入该验证码重置新密码。`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          alert('重置码及使用说明已复制到剪贴板，可直接粘贴发送给学员！');
        }).catch(() => {
          prompt('请复制以下重置文本发给学员：', text);
        });
      } else {
        prompt('请复制以下重置文本发给学员：', text);
      }
    },

    purgeAllUserData(reason) {
      const App = getApp();
      const keys = this.getActiveSyncKeys();
      localStorage.removeItem(keys.PROGRESS);
      if (keys.LEGACY_PROGRESS) localStorage.removeItem(keys.LEGACY_PROGRESS);
      localStorage.removeItem(KY_CONFIG.STORAGE_KEYS.TOKEN);
      localStorage.removeItem(KY_CONFIG.STORAGE_KEYS.USER_INFO);
      localStorage.removeItem(keys.LAST_SYNC_TIME);
      localStorage.removeItem(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK);
      localStorage.removeItem(keys.LAST_UPLOAD_HASH);

      this.token = null;
      this.currentUser = null;
      this.isDirty = false;
      this.lastSyncTime = null;

      if (App && App.state) {
        App.state.questions = [];
        App.state.mistakesList = [];
        App.state.overview = null;
        App.state.currentIndex = 0;
        App.state.selectedOptions = [];
        App.state.isEvaluated = false;
        App.state.isFlagged = false;
      }

      if (reason) {
        alert(reason);
      }
      location.reload();
    },

    handleSessionExpired(isSilent = false) {
      this.token = null;
      this.currentUser = null;
      localStorage.removeItem(KY_CONFIG.STORAGE_KEYS.TOKEN);
      localStorage.removeItem(KY_CONFIG.STORAGE_KEYS.USER_INFO);
      localStorage.removeItem(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK);
      this.renderAuthUI();
      if (!isSilent) {
        alert('🔑 您的登录凭证已过期或失效，本地做题记录已为您完整保留，请重新登录！');
        this.openAuthModal('login');
      }
    },

    handleUserDeleted() {
      const keep = confirm('⚠️ 您的账号在云端已被注销或不存在。\n\n点击【确定】：完整保留本地做题记录并转为离线访客模式；\n点击【取消】：清空本地所有答题记录与缓存。');
      if (keep) {
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem(KY_CONFIG.STORAGE_KEYS.TOKEN);
        localStorage.removeItem(KY_CONFIG.STORAGE_KEYS.USER_INFO);
        localStorage.removeItem(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK);
        this.renderAuthUI();
        alert('已为您保留本地做题记录，当前已转为离线访客模式。');
      } else {
        this.purgeAllUserData('账号已在云端注销，本地数据已清空。');
      }
    },

    setSession(token, user) {
      this.token = token;
      this.currentUser = user;
      localStorage.setItem(KY_CONFIG.STORAGE_KEYS.TOKEN, token);
      if (user) {
        localStorage.setItem(KY_CONFIG.STORAGE_KEYS.USER_INFO, JSON.stringify(user));
      }
      this.renderAuthUI();
    },

    computeDataFingerprint(compactData) {
      if (!compactData) return '0';
      const answers = compactData.answers || {};
      const mistakes = compactData.mistakes || {};
      const contentStr = JSON.stringify({ a: answers, m: mistakes });
      let hash = 5381;
      for (let i = 0; i < contentStr.length; i++) {
        hash = ((hash << 5) + hash) + contentStr.charCodeAt(i);
        hash |= 0;
      }
      const ansCount = Object.keys(answers).length;
      const misCount = Object.keys(mistakes).length;
      return `${ansCount}_${misCount}_${hash}`;
    },

    async checkSession() {
      if (!this.token) return;
      try {
        const cachedUser = localStorage.getItem(KY_CONFIG.STORAGE_KEYS.USER_INFO);
        if (cachedUser) {
          try {
            this.currentUser = JSON.parse(cachedUser);
            this.renderAuthUI();
          } catch (e) {}
        }

        if (this.token && this.token.includes('.')) {
          try {
            const payloadPart = this.token.split('.')[1];
            let base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '=';
            const payload = JSON.parse(atob(base64));
            if (payload && payload.exp && (Date.now() / 1000) > payload.exp) {
              this.handleSessionExpired(true);
              return;
            }
          } catch (_) {}
        }

        const now = Date.now();
        const lastCheck = parseInt(localStorage.getItem(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK) || '0', 10);
        if (lastCheck && (now - lastCheck < KY_CONFIG.SESSION.CHECK_INTERVAL_MS) && this.currentUser) {
          return;
        }

        const res = await fetch(this.getApiUrl('/api/auth/me'), {
          headers: { 'Authorization': `Bearer ${this.token}` },
          signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(KY_CONFIG.SYNC.TIMEOUT_MS) : undefined
        });

        if (res.status === 401) {
          this.handleSessionExpired(true);
          return;
        }
        if (res.status === 404) {
          this.handleUserDeleted();
          return;
        }

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.user) {
            this.currentUser = data.user;
            localStorage.setItem(KY_CONFIG.STORAGE_KEYS.USER_INFO, JSON.stringify(data.user));
            localStorage.setItem(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK, String(now));
            this.renderAuthUI();
          }
        }
      } catch (e) {}
    },

    logout(promptUser = true) {
      if (promptUser) {
        const confirmLogout = confirm('确定要退出当前账号登录吗？退出后将清空本机答题记录。');
        if (!confirmLogout) return;
        this.purgeAllUserData('已成功退出登录，本地所有答题记录已全部清空。');
        return;
      }
      this.purgeAllUserData();
    },

    resetLocalData() {
      const App = getApp();
      if (!confirm('⚠️ 确定要清空本机当前题库所有的刷题记录与错题本吗？\n清空后本机进度归零。若需同步清空云端，可在刷新后点击「上传」按钮覆盖云端。')) {
        return;
      }
      const keys = this.getActiveSyncKeys();
      localStorage.removeItem(keys.PROGRESS);
      if (keys.LEGACY_PROGRESS) localStorage.removeItem(keys.LEGACY_PROGRESS);
      DB.saveUserData({ answers: {}, mistakes: {} });
      DB.setPendingOverwrite(true);
      localStorage.removeItem(keys.LAST_SYNC_TIME);
      localStorage.removeItem(keys.LAST_UPLOAD_HASH);
      localStorage.setItem(keys.IS_DIRTY, '1');
      this.isDirty = true;
      this.lastSyncTime = null;

      if (App && App.state) {
        App.state.questions = [];
        App.state.mistakesList = [];
        App.state.overview = null;
        App.state.currentIndex = 0;
        App.state.selectedOptions = [];
        App.state.isEvaluated = false;
        App.state.isFlagged = false;
      }

      alert('本地当前题库所有刷题记录与错题本已成功清空！\n当前处于待上传状态。如需同步清空云端，请点击同步按钮上传覆盖。');
      location.reload();
    },

    /**
     * ☁️ 上传当前题库进度到云端（支持 bankId、expectedVersion 乐观锁 409 自动拉取合并重试、overwrite 快照覆盖）
     */
    async uploadToCloud(isSilent = false) {
      const App = getApp();
      if (!this.token) {
        if (!isSilent) this.openAuthModal('login');
        return;
      }

      const bankId = DB.currentBankId;
      const keys = this.getActiveSyncKeys(bankId);
      const compactData = DB.toCompact(bankId);
      const currentHash = this.computeDataFingerprint(compactData);
      const lastUploadHash = localStorage.getItem(keys.LAST_UPLOAD_HASH);

      if (!this.isDirty && lastUploadHash && lastUploadHash === currentHash) {
        if (!isSilent) {
          App.showToast('💡 当前做题进度已与云端一致，无需重复保存！', 'info');
        }
        this.isNetworkWeak = false;
        this.updateSyncUI();
        return;
      }

      if (!isSilent) {
        const ok = confirm('⚠️ 确定要将当前题库进度同步保存至云端吗？');
        if (!ok) return;
      }

      if (this.isSyncing) return;

      try {
        this.isSyncing = true;
        this.retryStatusText = '';
        this.updateSyncUI();

        const shouldOverwrite = DB.hasPendingOverwrite(bankId);
        const expectedVersion = DB.getCloudVersion(bankId);

        const doPost = async (payloadCompact, ver, overwriteFlag) => {
          const bodyObj = {
            bankId,
            ...payloadCompact,
            overwrite: !!overwriteFlag,
            dataHash: this.computeDataFingerprint(payloadCompact)
          };
          if (ver !== null && ver !== undefined) {
            bodyObj.expectedVersion = ver;
          }
          return this.fetchWithRetry(
            this.getApiUrl('/api/progress/sync'),
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
              },
              body: JSON.stringify(bodyObj)
            },
            2,
            KY_CONFIG.SYNC.TIMEOUT_MS,
            (attempt, maxRetries) => {
              this.retryStatusText = `重试中 (${attempt}/${maxRetries})...`;
              this.updateSyncUI();
            }
          );
        };

        let res = await doPost(compactData, expectedVersion, shouldOverwrite);

        if (res.status === 401) {
          this.handleSessionExpired(isSilent);
          return;
        }
        if (res.status === 404) {
          this.handleUserDeleted();
          return;
        }

        let data = await res.json();

        // 乐观锁冲突 (HTTP 409 VERSION_CONFLICT)：在本地按时间戳合并云端最新记录并以新版本号无缝补传
        if (res.status === 409 && data && data.code === 'VERSION_CONFLICT') {
          if (shouldOverwrite) {
            DB.setCloudVersion(data.version, bankId);
            res = await doPost(compactData, data.version, true);
          } else {
            DB.mergeFromCompact(data, bankId);
            const mergedCompact = DB.toCompact(bankId);
            res = await doPost(mergedCompact, data.version, false);
          }
          data = await res.json();
        }

        if (!res.ok || !data.success) {
          throw new Error((data && data.error) || '上传保存失败');
        }

        // 若服务端执行了时间戳合并并返回了合并后的最新全集，同步回写本地
        if (data.answers && data.mistakes && !shouldOverwrite) {
          DB.mergeFromCompact(data, bankId);
        }
        if (Number.isFinite(data.version)) {
          DB.setCloudVersion(data.version, bankId);
        }
        DB.setPendingOverwrite(false, bankId);

        this.lastSyncTime = data.updatedAt || Date.now();
        localStorage.setItem(keys.LAST_SYNC_TIME, String(this.lastSyncTime));
        const updatedCompact = DB.toCompact(bankId);
        localStorage.setItem(keys.LAST_UPLOAD_HASH, this.computeDataFingerprint(updatedCompact));
        localStorage.removeItem(keys.IS_DIRTY);
        this.isDirty = false;
        this.isNetworkWeak = false;
        this.retryStatusText = '';
        this.updateSyncUI();

        if (!isSilent) {
          if (data.notModified) {
            App.showToast('💡 当前做题进度已与云端一致，无需重复保存！', 'info');
          } else {
            App.showToast('☁️ 当前最新做题记录与错题本已成功保存至云端！', 'success');
          }
        }
      } catch (err) {
        console.error('Upload failed:', err);
        this.isNetworkWeak = true;
        this.isDirty = true;
        this.retryStatusText = '';
        this.updateSyncUI();

        if (!isSilent) {
          const isTimeout = err && (err.name === 'TimeoutError' || (err.message && err.message.toLowerCase().includes('timeout')));
          if (isTimeout) {
            App.showToast('⚠️ 网络连接较弱（已重试2次）。答题进度已暂存本地，联网后自动同步！', 'warning', 4000);
          } else {
            App.showToast(`⚠️ 云端连接异常，答题已暂存本机（${err.message || '网络不稳定'}）`, 'warning', 4000);
          }
        }
      } finally {
        this.isSyncing = false;
        this.retryStatusText = '';
        this.updateSyncUI();
      }
    },

    /**
     * 📥 从云端下载当前题库进度
     */
    async downloadFromCloud(isSilent = false) {
      const App = getApp();
      if (!this.token) {
        if (!isSilent) this.openAuthModal('login');
        return;
      }

      if (!isSilent) {
        const ok = confirm('⚠️ 确定要从云端下载数据吗？\n下载后将用云端保存的进度直接覆盖本机当前题库进度。');
        if (!ok) return;
      }

      if (this.isSyncing) return;

      const bankId = DB.currentBankId;
      const keys = this.getActiveSyncKeys(bankId);

      try {
        this.isSyncing = true;
        this.retryStatusText = '';
        this.updateSyncUI();

        const clientTime = this.lastSyncTime || 0;
        const qs = new URLSearchParams({
          bankId,
          clientTime: String(clientTime)
        });
        const res = await this.fetchWithRetry(
          this.getApiUrl(`/api/progress/sync?${qs.toString()}`),
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.token}`
            }
          },
          2,
          KY_CONFIG.SYNC.TIMEOUT_MS,
          (attempt, maxRetries) => {
            this.retryStatusText = `重试中 (${attempt}/${maxRetries})...`;
            this.updateSyncUI();
          }
        );

        if (res.status === 401) {
          this.handleSessionExpired(isSilent);
          return;
        }
        if (res.status === 404) {
          this.handleUserDeleted();
          return;
        }

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '从云端下载失败');
        }

        if (Number.isFinite(data.version)) {
          DB.setCloudVersion(data.version, bankId);
        }

        if (data.notModified) {
          this.isNetworkWeak = false;
          this.updateSyncUI();
          if (!isSilent) {
            App.showToast('💡 云端数据与本机一致（无更新），无需重复覆盖！', 'info');
          }
          return;
        }

        DB.setFromCloud(data, bankId);
        DB.setPendingOverwrite(false, bankId);
        this.lastSyncTime = data.updatedAt || Date.now();
        localStorage.setItem(keys.LAST_SYNC_TIME, String(this.lastSyncTime));
        const newCompact = DB.toCompact(bankId);
        localStorage.setItem(keys.LAST_UPLOAD_HASH, this.computeDataFingerprint(newCompact));
        localStorage.removeItem(keys.IS_DIRTY);
        this.isDirty = false;
        this.isNetworkWeak = false;
        this.retryStatusText = '';
        this.updateSyncUI();

        if (!isSilent) {
          App.showToast('📥 云端数据同步成功！即将刷新呈现最新进度...', 'success', 2000);
          setTimeout(() => location.reload(), 1200);
        }
      } catch (err) {
        console.error('Download failed:', err);
        this.isNetworkWeak = true;
        this.updateSyncUI();

        if (!isSilent) {
          const isTimeout = err && (err.name === 'TimeoutError' || (err.message && err.message.toLowerCase().includes('timeout')));
          if (isTimeout) {
            App.showToast('⚠️ 云端下载超时（已重试2次）。请检查网络，本机答题记录完好保留！', 'warning', 4000);
          } else {
            App.showToast(`⚠️ 从云端下载失败: ${err.message || '网络不稳定'}`, 'warning', 4000);
          }
        }
      } finally {
        this.isSyncing = false;
        this.retryStatusText = '';
        this.updateSyncUI();
      }
    },

    async syncProgress(isSilent = false) {
      return this.uploadToCloud(isSilent);
    },
    async fetchCloudProgress() {
      return this.downloadFromCloud(true);
    }
  };
}
