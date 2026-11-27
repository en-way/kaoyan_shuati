/**
 * 管理员密码重置码面板与会话级密钥管理模块 (js/core/admin-ui.js)
 */
import { KyApi } from '../api.js';
import { KY_CONFIG } from '../config.js';

const ADMIN_SECRET_KEY = 'kaoyan_admin_secret_saved';

export function createAdminUiMethods(getApp) {
  return {
    _getSavedAdminSecret() {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(ADMIN_SECRET_KEY);
        }
        if (typeof sessionStorage !== 'undefined') {
          return sessionStorage.getItem(ADMIN_SECRET_KEY) || '';
        }
      } catch (_) {}
      return '';
    },

    _setSavedAdminSecret(secret) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(ADMIN_SECRET_KEY);
        }
        if (typeof sessionStorage !== 'undefined') {
          if (secret) sessionStorage.setItem(ADMIN_SECRET_KEY, secret);
          else sessionStorage.removeItem(ADMIN_SECRET_KEY);
        }
      } catch (_) {}
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

      const savedSecret = this._getSavedAdminSecret();
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

        const res = await KyApi.fetchWithRetry(
          this.getApiUrl('/api/admin/verify-secret'),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-secret': secret
            },
            body: JSON.stringify({ adminSecret: secret })
          },
          { maxRetries: 0, timeoutMs: KY_CONFIG.SYNC.TIMEOUT_MS }
        );

        const parsed = await KyApi.parseResponse(res);
        const data = parsed.data;
        if (!parsed.ok || !data.isValid) {
          throw new Error(parsed.error || data.error || '密钥校验失败');
        }

        this._setSavedAdminSecret(secret);
        if (clearLink) clearLink.style.display = 'inline';

        if (notice) {
          notice.textContent = data.message || '✅ 密钥有效！';
          notice.className = 'auth-notice success';
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
      this._setSavedAdminSecret('');
      const secretInput = document.getElementById('adminSecretKey');
      const clearLink = document.getElementById('adminClearSecretLink');
      const notice = document.getElementById('adminNotice');
      if (secretInput) secretInput.value = '';
      if (clearLink) clearLink.style.display = 'none';
      if (notice) {
        notice.textContent = '已清除当前会话记住的管理员密钥';
        notice.className = 'auth-notice';
        notice.style.display = 'block';
      }
    },

    async handleAdminGenerateCode(e) {
      e.preventDefault();
      const secretEl = document.getElementById('adminSecretKey');
      const targetUserEl = document.getElementById('adminTargetUsername');
      const adminSecret = (secretEl ? secretEl.value : '').trim();
      const username = (targetUserEl ? targetUserEl.value : '').trim();
      const notice = document.getElementById('adminNotice');
      const resultBox = document.getElementById('adminResultBox');
      const codeDisplay = document.getElementById('adminGeneratedCode');
      const submitBtn = document.getElementById('btnAdminGenerate');
      const clearLink = document.getElementById('adminClearSecretLink');

      if (!adminSecret || !username) {
        if (notice) {
          notice.textContent = '请输入管理员密钥与学员账号';
          notice.className = 'auth-notice error';
          notice.style.display = 'block';
        }
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = '生成中...';
        }
        if (notice) notice.style.display = 'none';

        const res = await KyApi.fetchWithRetry(
          this.getApiUrl('/api/admin/generate-reset-code'),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-secret': adminSecret
            },
            body: JSON.stringify({ adminSecret, username })
          },
          { maxRetries: 0, timeoutMs: KY_CONFIG.SYNC.TIMEOUT_MS }
        );

        const parsed = await KyApi.parseResponse(res);
        const data = parsed.data;
        if (!parsed.ok) {
          throw new Error(parsed.error || data.error || '生成重置码失败');
        }

        this._setSavedAdminSecret(adminSecret);
        if (clearLink) clearLink.style.display = 'inline';

        if (codeDisplay) codeDisplay.textContent = data.code;
        if (resultBox) resultBox.style.display = 'block';
        if (notice) {
          notice.textContent = `学员「${data.nickname || data.username}」的 6 位重置码已生成！`;
          notice.className = 'auth-notice success';
          notice.style.display = 'block';
        }

        this._lastAdminResult = {
          username: data.username,
          code: data.code,
          expiresIn: data.expiresInMinutes || 15
        };
      } catch (err) {
        if (notice) {
          notice.textContent = err.message;
          notice.className = 'auth-notice error';
          notice.style.display = 'block';
        }
        if (resultBox) resultBox.style.display = 'none';
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '⚡ 生成 6 位重置验证码';
        }
      }
    },

    copyAdminGeneratedCode() {
      const App = getApp();
      if (!this._lastAdminResult) return;
      const text = `【考研政治 1000 题】学员 ${this._lastAdminResult.username}，您的密码重置码为：${this._lastAdminResult.code}，请在 ${this._lastAdminResult.expiresIn} 分钟内点击登录界面的「忘记密码」输入该验证码重置新密码。`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          App.showToast('📋 重置码及使用说明已复制到剪贴板，可直接发送给学员！', 'success', 3600);
        }).catch(() => {
          App.showToast(`⚠️ 自动复制受限，请直接长按/选中上方重置码 ${this._lastAdminResult.code} 复制`, 'warning', 4500);
        });
      } else {
        App.showToast(`⚠️ 请直接选中上方重置码 ${this._lastAdminResult.code} 复制发送`, 'warning', 4500);
      }
    }
  };
}
