/**
 * 题库大厅视图层 (js/ui/hub-view.js)
 * 负责大厅统计总览、多题库胶囊切换栏、科目 Tab、章节卡片网格与顶栏面包屑导航。
 */
import { DB } from '../state/store.js';
import { escapeHtml } from './sanitize.js';

export const hubViewMethods = {
  // ================== 多题库/年份动态切换 UI（大厅卡片/胶囊切换栏） ==================
  renderBankSelector() {
    const meta = DB.getBankMeta(DB.currentBankId);
    const yearBadge = document.getElementById('brandYearBadge');
    if (yearBadge && meta && meta.year) {
      yearBadge.textContent = String(meta.year);
    }

    const titleEl = document.getElementById('hubWelcomeTitle');
    if (titleEl && meta && meta.title) {
      titleEl.textContent = `${meta.title} · 官方全真题库`;
    }
    const descEl = document.getElementById('hubWelcomeDesc');
    if (descEl && meta && meta.description) {
      descEl.textContent = meta.description;
    }

    const switcher = document.getElementById('hubBankSwitcher');
    if (!switcher) return;

    const banks = (DB.catalog && Array.isArray(DB.catalog.banks)) ? DB.catalog.banks : [];
    if (banks.length <= 1) {
      const b = banks[0] || meta;
      const qCount = (b && b.questionCount) ? `${b.questionCount.toLocaleString()} 题` : '全量解析';
      switcher.innerHTML = `
        <div class="bank-active-badge" title="当前题库进度与错题本已独立存档">
          <span class="bank-badge-dot"></span>
          <span class="bank-badge-year">${escapeHtml(b.year || 2027)}版</span>
          <span class="bank-badge-name">${escapeHtml(b.shortTitle || b.title || '肖1000题')}</span>
          <span class="bank-badge-count">${escapeHtml(qCount)}</span>
        </div>
      `;
      return;
    }

    const pillsHtml = banks.map(b => {
      const isAct = b.id === DB.currentBankId;
      const activeClass = isAct ? 'active' : '';
      const label = b.shortTitle || `${b.year}版1000题`;
      const qCount = b.questionCount ? `${b.questionCount}题` : '';
      return `
        <button type="button"
                class="bank-pill-btn ${activeClass}"
                data-action="switch-bank"
                data-bank-id="${escapeHtml(b.id)}"
                title="${escapeHtml(b.title || label)}（做题进度与错题本按题库独立保存）">
          <span class="bank-pill-year">${escapeHtml(b.year || '')}</span>
          <span class="bank-pill-title">${escapeHtml(label)}</span>
          ${qCount ? `<span class="bank-pill-cnt">${escapeHtml(qCount)}</span>` : ''}
        </button>
      `;
    }).join('');

    switcher.innerHTML = `
      <div class="bank-pills-group" role="tablist" aria-label="切换年份题库">
        <span class="bank-switcher-label">📚 题库切换:</span>
        <div class="bank-pills-list">${pillsHtml}</div>
      </div>
    `;
  },

  async switchQuestionBank(targetBankId) {
    if (!targetBankId || targetBankId === DB.currentBankId) return;

    // 切换前若当前已登录且当前题库有未同步进度，静默触发一次后台保存
    if (this.auth && this.auth.token && this.auth.isDirty && !this.auth.isSyncing) {
      try {
        await this.auth.uploadToCloud(true);
      } catch (_) {}
    }

    const ok = await DB.switchBank(targetBankId);
    if (!ok) {
      this.renderBankSelector();
      return;
    }

    this.state.activeSubjectIndex = 0;
    this.state.questions = [];
    this.state.currentIndex = 0;
    this.state.filterPart = '';
    this.state.filterChapter = '';

    if (this.auth && typeof this.auth.refreshBankSyncState === 'function') {
      this.auth.refreshBankSyncState(DB.currentBankId);
    }

    this.renderBankSelector();
    this.navigateTo('hub');
    const meta = DB.getBankMeta(DB.currentBankId);
    this.showToast(`📚 已切换至「${meta.title || meta.id}」`, 'success');
  },

  // ================== NAVIGATION & BREADCRUMB ==================
  updateBreadcrumb(text) {
    const crumbEl = document.getElementById('crumbSubject');
    if (crumbEl && text) {
      crumbEl.textContent = text;
      crumbEl.setAttribute('title', text);
    }
  },

  navigateTo(viewName) {
    if (viewName !== 'practice' && this.state.questionTimerTimer) {
      clearInterval(this.state.questionTimerTimer);
      this.state.questionTimerTimer = null;
    }
    this.state.currentView = viewName;
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.m-nav-item').forEach(btn => btn.classList.remove('active'));

    if (viewName === 'hub') {
      document.getElementById('viewHub').classList.add('active');
      document.getElementById('navHubBtn').classList.add('active');
      const mBtn = document.getElementById('mNavHubBtn');
      if (mBtn) mBtn.classList.add('active');
      this.loadOverview();
      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else if (viewName === 'practice') {
      document.getElementById('viewPractice').classList.add('active');
      document.getElementById('navPracticeBtn').classList.add('active');
      const mBtn = document.getElementById('mNavPracticeBtn');
      if (mBtn) mBtn.classList.add('active');
      if (!this.state.questions.length) {
        const firstSub = (this.state.overview && this.state.overview.subjects && this.state.overview.subjects[0]);
        const defaultPart = firstSub ? firstSub.name : '第一部分 马克思主义基本原理';
        const defaultCh = (firstSub && firstSub.chapters && firstSub.chapters[0]) ? firstSub.chapters[0].name : '导论';
        this.startPractice(defaultPart, defaultCh, '', 'instant');
      } else {
        const currentQ = this.getCurrentQuestion();
        if (currentQ) {
          const shortSub = this.getSubjectShortName(currentQ.part);
          this.updateBreadcrumb(`${shortSub} · ${currentQ.chapter}`);
        }
        this.renderQuestion();
      }
    } else if (viewName === 'mistakes') {
      document.getElementById('viewMistakes').classList.add('active');
      document.getElementById('navMistakesBtn').classList.add('active');
      const mBtn = document.getElementById('mNavMistakesBtn');
      if (mBtn) mBtn.classList.add('active');
      this.updateBreadcrumb('错题攻坚集');
      this.loadMistakes();
    }
  },

  // ================== VIEW 1: HUB ==================
  loadOverview() {
    const data = DB.getOverview();
    this.state.overview = data;

    document.getElementById('hubTotalQ').textContent = data.total_questions.toLocaleString();
    document.getElementById('hubAnsweredQ').textContent = data.total_answered.toLocaleString();
    document.getElementById('hubMistakesQ').textContent = data.total_mistakes.toLocaleString();
    document.getElementById('hubAccuracyRate').textContent = `${data.overall_accuracy}%`;

    const badge = document.getElementById('globalMistakeBadge');
    if (badge) badge.textContent = data.total_mistakes;
    const mBadge = document.getElementById('mGlobalMistakeBadge');
    if (mBadge) mBadge.textContent = data.total_mistakes;

    if (this.state.currentView === 'hub' && data.subjects && data.subjects[this.state.activeSubjectIndex]) {
      const curSub = data.subjects[this.state.activeSubjectIndex];
      this.updateBreadcrumb(this.getSubjectShortName(curSub.name) || curSub.name);
    }

    this.renderBankSelector();
    this.renderSubjectTabs();
    this.renderChaptersGrid();
  },

  renderSubjectTabs() {
    const container = document.getElementById('subjectTabsContainer');
    if (!container || !this.state.overview) return;

    container.innerHTML = this.state.overview.subjects.map((sub, idx) => {
      const active = idx === this.state.activeSubjectIndex ? 'active' : '';
      const fullName = sub.name.replace(/^第[一二三四五]部分\s*/, '');
      const shortName = this.getSubjectShortName(sub.name);
      return `
        <button type="button"
                class="subject-tab ${active}"
                data-action="select-subject"
                data-index="${idx}"
                title="${escapeHtml(fullName)} (${escapeHtml(sub.answered)}/${escapeHtml(sub.total)})">
          <span class="sub-tab-name-full">${escapeHtml(fullName)}</span>
          <span class="sub-tab-name-short">${escapeHtml(shortName)}</span>
          <span class="sub-tab-count">(${escapeHtml(sub.answered)}/${escapeHtml(sub.total)})</span>
        </button>
      `;
    }).join('');
  },

  selectSubjectTab(idx) {
    this.state.activeSubjectIndex = idx;
    if (this.state.overview && this.state.overview.subjects && this.state.overview.subjects[idx]) {
      const sub = this.state.overview.subjects[idx];
      this.updateBreadcrumb(this.getSubjectShortName(sub.name) || sub.name);
    }
    this.renderSubjectTabs();
    this.renderChaptersGrid();
  },

  renderChaptersGrid() {
    const container = document.getElementById('chaptersGridContainer');
    if (!container || !this.state.overview) return;

    const currentSub = this.state.overview.subjects[this.state.activeSubjectIndex];
    if (!currentSub) return;

    container.innerHTML = currentSub.chapters.map(ch => {
      const percent = ch.total > 0 ? Math.round((ch.answered / ch.total) * 100) : 0;
      const safePart = escapeHtml(currentSub.name);
      const safeChapter = escapeHtml(ch.name);
      const accBadge = ch.answered > 0
        ? `<span class="ch-acc-badge">正确率 ${escapeHtml(ch.accuracy)}%</span>`
        : `<span class="ch-acc-badge empty">未答</span>`;

      const mistakePill = ch.mistakes > 0
        ? `<button type="button" class="btn-mistake-pill" data-action="start-practice" data-part="${safePart}" data-chapter="${safeChapter}" data-mode="mistakes_only">❌ 错题 (${escapeHtml(ch.mistakes)})</button>`
        : '';

      return `
        <div class="chapter-card">
          <div class="chapter-card-header">
            <h4 class="chapter-title">${safeChapter}</h4>
            ${accBadge}
          </div>

          <div class="chapter-meta-row">
            <span>单选: <strong>${escapeHtml(ch.single_count)}</strong> | 多选: <strong>${escapeHtml(ch.multi_count)}</strong></span>
            <span>进度: <strong>${escapeHtml(ch.answered)}/${escapeHtml(ch.total)}</strong> (${percent}%)</span>
          </div>

          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${percent}%;"></div>
          </div>

          <div class="chapter-actions-row">
            <button type="button" class="btn-card-primary" data-action="start-practice" data-part="${safePart}" data-chapter="${safeChapter}" data-mode="instant">
              ⚡ 即时刷题
            </button>
            <button type="button" class="btn-card-secondary" data-action="start-practice" data-part="${safePart}" data-chapter="${safeChapter}" data-mode="exam">
              📝 模考
            </button>
            <button type="button" class="btn-card-secondary" data-action="start-practice" data-part="${safePart}" data-chapter="${safeChapter}" data-mode="recite">
              📖 背题
            </button>
          </div>

          <div class="chapter-sub-actions">
            <div>${mistakePill}</div>
            <button type="button" class="btn-reset-ch" data-action="reset-chapter" data-part="${safePart}" data-chapter="${safeChapter}">
              🔄 重置本章
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  async resetChapter(part, chapter) {
    const confirmed = await this.showConfirm({
      title: '重置章节进度',
      message: `确定要重置【${chapter}】的作答记录吗？该章节的历史答题数据将被清空。`,
      confirmText: '确定重置',
      cancelText: '取消',
      danger: true
    });
    if (!confirmed) return;

    DB.resetChapter(part, chapter);
    if (this.state.currentPart === part && this.state.currentChapter === chapter) {
      this.state.questions = [];
      this.state.currentIndex = 0;
    }
    this.loadOverview();
    if (typeof this.showToast === 'function') {
      this.showToast(`🔄 已清空【${chapter}】作答记录`, 'info');
    }
  },

  getSubjectShortName(part) {
    if (!part) return '';
    if (part.includes('马克思主义基本原理')) return '马原';
    if (part.includes('毛泽东思想')) return '毛中特';
    if (part.includes('习近平新时代')) return '习思想';
    if (part.includes('近现代史纲要')) return '史纲';
    if (part.includes('思想道德与法治')) return '思修';
    return part.replace(/^第[一二三四五]部分\s*/, '');
  },

  resetLocalData() {
    this.auth.resetLocalData();
  }
};
