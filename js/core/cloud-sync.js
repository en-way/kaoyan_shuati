/**
 * 多题库云端同步调度、指纹防抖、409 乐观锁合并与登出清理模块 (js/core/cloud-sync.js)
 */
import { KY_CONFIG } from '../config.js';
import { KyApi } from '../api.js';
import { DB } from '../state/store.js';

export function createCloudSyncMethods(getApp) {
  return {
    _lsGet(key) {
      try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
      } catch (_) {
        return null;
      }
    },

    _lsSet(key, value) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, String(value));
        }
      } catch (_) {}
    },

    _lsRemove(key) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(key);
        }
      } catch (_) {}
    },

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
      const rawTime = this._lsGet(keys.LAST_SYNC_TIME);
      this.lastSyncTime = rawTime ? parseInt(rawTime, 10) : null;

      try {
        const compactData = DB.toCompact(bankId);
        const currentHash = this.computeDataFingerprint(compactData);
        const lastUploadHash = this._lsGet(keys.LAST_UPLOAD_HASH);
        const isExplicitDirty = this._lsGet(keys.IS_DIRTY) === '1';
        this.isDirty = Boolean(isExplicitDirty || (lastUploadHash && currentHash !== lastUploadHash));
      } catch (e) {
        this.isDirty = false;
      }
      this.updateSyncUI();
    },

    init() {
      document.addEventListener('click', (e) => {
        if (e && e.target && typeof e.target.closest === 'function' && e.target.closest('#userDropdownMenu, [data-action="auth-toggle-menu"]')) {
          return;
        }
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
      this._lsSet(keys.IS_DIRTY, '1');
      this.updateSyncUI();
    },

    purgeAllUserData(reason) {
      const App = getApp();
      const exactKeys = new Set([
        KY_CONFIG.STORAGE_KEYS.TOKEN,
        KY_CONFIG.STORAGE_KEYS.USER_INFO,
        KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK,
        KY_CONFIG.STORAGE_KEYS.USER_DATA,
        KY_CONFIG.STORAGE_KEYS.CURRENT_BANK_ID,
        KY_CONFIG.STORAGE_KEYS.MIGRATED_V38,
        'kaoyan_admin_secret_saved'
      ]);
      const bankPrefixes = [
        'kaoyan_progress_',
        'kaoyan_last_sync_time_',
        'kaoyan_last_upload_hash_',
        'kaoyan_is_dirty_',
        'kaoyan_cloud_version_',
        'kaoyan_pending_overwrite_'
      ];

      try {
        const allKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) allKeys.push(k);
        }
        for (const k of allKeys) {
          if (exactKeys.has(k) || bankPrefixes.some(p => k.startsWith(p))) {
            localStorage.removeItem(k);
          }
        }
      } catch (_) {}

      this._setSavedAdminSecret('');

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

      this.renderAuthUI();

      if (reason && App && typeof App.showToast === 'function') {
        App.showToast(reason, 'info', 2000);
        setTimeout(() => location.reload(), 650);
      } else {
        location.reload();
      }
    },

    handleSessionExpired(isSilent = false) {
      const App = getApp();
      this.token = null;
      this.currentUser = null;
      this._lsRemove(KY_CONFIG.STORAGE_KEYS.TOKEN);
      this._lsRemove(KY_CONFIG.STORAGE_KEYS.USER_INFO);
      this._lsRemove(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK);
      this.renderAuthUI();
      if (!isSilent) {
        App.showToast('🔑 您的登录凭证已过期或失效，本地做题记录已完整保留，请重新登录！', 'warning', 4200);
        this.openAuthModal('login');
      }
    },

    async handleUserDeleted() {
      const App = getApp();
      const shouldPurge = await App.showConfirm({
        title: '账号云端状态异常',
        message: '您的账号在云端已被注销或不存在。\n\n如需完整保留当前做题记录并转为离线访客模式，请点击「保留本地继续离线」；如确认清空本机所有答题缓存，请点击「清空本地缓存」。',
        confirmText: '清空本地缓存',
        cancelText: '保留本地继续离线',
        danger: true
      });
      if (shouldPurge) {
        this.purgeAllUserData('账号已在云端注销，本地数据已清空');
      } else {
        this.token = null;
        this.currentUser = null;
        this._lsRemove(KY_CONFIG.STORAGE_KEYS.TOKEN);
        this._lsRemove(KY_CONFIG.STORAGE_KEYS.USER_INFO);
        this._lsRemove(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK);
        this.renderAuthUI();
        App.showToast('已保留本地做题记录，当前转为离线访客模式', 'info', 3500);
      }
    },

    setSession(token, user) {
      this.token = token;
      this.currentUser = user;
      this._lsSet(KY_CONFIG.STORAGE_KEYS.TOKEN, token);
      if (user) {
        this._lsSet(KY_CONFIG.STORAGE_KEYS.USER_INFO, JSON.stringify(user));
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
        const cachedUser = this._lsGet(KY_CONFIG.STORAGE_KEYS.USER_INFO);
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
        const lastCheck = parseInt(this._lsGet(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK) || '0', 10);
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
          await this.handleUserDeleted();
          return;
        }

        if (res.ok) {
          const parsed = await KyApi.parseResponse(res);
          const data = parsed.data;
          if (parsed.ok && data.user) {
            this.currentUser = data.user;
            this._lsSet(KY_CONFIG.STORAGE_KEYS.USER_INFO, JSON.stringify(data.user));
            this._lsSet(KY_CONFIG.STORAGE_KEYS.LAST_SESSION_CHECK, String(now));
            this.renderAuthUI();
          }
        }
      } catch (e) {}
    },

    async logout(promptUser = true) {
      const App = getApp();
      if (promptUser) {
        const confirmLogout = await App.showConfirm({
          title: '退出登录确认',
          message: '确定要退出当前账号登录吗？退出后将清空本机各题库的答题缓存。',
          confirmText: '确认退出',
          cancelText: '取消',
          danger: true
        });
        if (!confirmLogout) return;
        this.purgeAllUserData('已成功退出登录，本地答题记录已清空');
        return;
      }
      this.purgeAllUserData();
    },

    async resetLocalData() {
      const App = getApp();
      const confirmed = await App.showConfirm({
        title: '清空本机记录',
        message: '确定要清空本机当前题库所有的刷题记录与错题本吗？\n清空后本机进度归零。若需同步清空云端，可在刷新后点击「上传云端」覆盖。',
        confirmText: '确定清空',
        cancelText: '取消',
        danger: true
      });
      if (!confirmed) return;

      const keys = this.getActiveSyncKeys();
      this._lsRemove(keys.PROGRESS);
      if (keys.LEGACY_PROGRESS) this._lsRemove(keys.LEGACY_PROGRESS);
      DB.saveUserData({ answers: {}, mistakes: {} });
      DB.setPendingOverwrite(true);
      this._lsRemove(keys.LAST_SYNC_TIME);
      this._lsRemove(keys.LAST_UPLOAD_HASH);
      this._lsSet(keys.IS_DIRTY, '1');
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

      App.showToast('🧹 已清空本机当前题库所有刷题记录与错题本！', 'success', 2000);
      setTimeout(() => location.reload(), 700);
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
      const lastUploadHash = this._lsGet(keys.LAST_UPLOAD_HASH);

      if (!this.isDirty && lastUploadHash && lastUploadHash === currentHash) {
        if (!isSilent) {
          App.showToast('💡 当前做题进度已与云端一致，无需重复保存！', 'info');
        }
        this.isNetworkWeak = false;
        this.updateSyncUI();
        return;
      }

      if (!isSilent) {
        const ok = await App.showConfirm({
          title: '上传进度至云端',
          message: '确定要将当前题库做题进度与错题本保存至云端吗？',
          confirmText: '立即上传',
          cancelText: '取消',
          danger: false
        });
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
          await this.handleUserDeleted();
          return;
        }

        let parsed = await KyApi.parseResponse(res);
        let data = parsed.data;

        if (res.status === 409 && data && data.code === 'VERSION_CONFLICT') {
          if (shouldOverwrite) {
            DB.setCloudVersion(data.version, bankId);
            res = await doPost(compactData, data.version, true);
          } else {
            DB.mergeFromCompact(data, bankId);
            const mergedCompact = DB.toCompact(bankId);
            res = await doPost(mergedCompact, data.version, false);
          }
          parsed = await KyApi.parseResponse(res);
          data = parsed.data;
        }

        if (!parsed.ok) {
          throw new Error(parsed.error || (data && data.error) || '上传保存失败');
        }

        if (data.answers && data.mistakes && !shouldOverwrite) {
          DB.mergeFromCompact(data, bankId);
        }
        if (Number.isFinite(data.version)) {
          DB.setCloudVersion(data.version, bankId);
        }
        DB.setPendingOverwrite(false, bankId);

        this.lastSyncTime = data.updatedAt || Date.now();
        this._lsSet(keys.LAST_SYNC_TIME, String(this.lastSyncTime));
        const updatedCompact = DB.toCompact(bankId);
        this._lsSet(keys.LAST_UPLOAD_HASH, this.computeDataFingerprint(updatedCompact));
        this._lsRemove(keys.IS_DIRTY);
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
        const ok = await App.showConfirm({
          title: '从云端下载覆盖',
          message: '确定要从云端下载数据吗？\n下载后将用云端保存的进度覆盖本机当前题库进度。',
          confirmText: '确定下载覆盖',
          cancelText: '取消',
          danger: true
        });
        if (!ok) return;
      }

      if (this.isSyncing) return;

      const bankId = DB.currentBankId;
      const keys = this.getActiveSyncKeys(bankId);

      try {
        this.isSyncing = true;
        this.retryStatusText = '';
        this.updateSyncUI();

        // 仅静默同步且本机无未上传修改时利用 clientTime 节流；显式覆盖或有脏数据时强制全量拉取
        const clientTime = (isSilent && !this.isDirty && this.lastSyncTime) ? this.lastSyncTime : 0;
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
          await this.handleUserDeleted();
          return;
        }

        const parsed = await KyApi.parseResponse(res);
        const data = parsed.data;
        if (!parsed.ok) {
          throw new Error(parsed.error || data.error || '从云端下载失败');
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
        this._lsSet(keys.LAST_SYNC_TIME, String(this.lastSyncTime));
        const newCompact = DB.toCompact(bankId);
        this._lsSet(keys.LAST_UPLOAD_HASH, this.computeDataFingerprint(newCompact));
        this._lsRemove(keys.IS_DIRTY);
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
