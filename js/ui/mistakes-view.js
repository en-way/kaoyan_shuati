/**
 * 错题攻坚集视图层 (js/ui/mistakes-view.js)
 * 负责错题本加载、科目/章节二级联动筛选、错题卡片渲染、单题重刷与标为已攻克。
 */
import { DB } from '../state/store.js';

export const mistakesViewMethods = {
  // ================== VIEW 3: MISTAKES VAULT ==================
  loadMistakes() {
    const part = this.state.filterPart;
    const chapter = this.state.filterChapter;
    const data = DB.getMistakes(part, chapter);
    this.state.mistakesList = data.mistakes || [];

    const totalMistakesCount = DB.getMistakes('', '').count;
    const mCountEl = document.getElementById('mMistakesCountText');
    if (mCountEl) mCountEl.textContent = `共 ${data.count} 道待攻克错题`;

    const globalBadge = document.getElementById('globalMistakeBadge');
    if (globalBadge) globalBadge.textContent = totalMistakesCount;
    const mGlobalBadge = document.getElementById('mGlobalMistakeBadge');
    if (mGlobalBadge) mGlobalBadge.textContent = totalMistakesCount;

    this.populateMistakeFilters();
    this.renderMistakesList();
  },

  populateMistakeFilters() {
    const allMistakesData = DB.getMistakes('', '');
    const allList = allMistakesData.mistakes || [];
    const totalAllCount = allList.length;

    const statsByPart = {};
    allList.forEach(m => {
      const p = m.part || '其他';
      const ch = m.chapter || '未分类';
      if (!statsByPart[p]) {
        statsByPart[p] = { count: 0, chapters: {} };
      }
      statsByPart[p].count++;
      statsByPart[p].chapters[ch] = (statsByPart[p].chapters[ch] || 0) + 1;
    });

    const pSelect = document.getElementById('mPartFilter');
    if (pSelect) {
      const currentPart = this.state.filterPart || '';
      let partHtml = `<option value="">全部科目 (${totalAllCount}题)</option>`;

      if (this.state.overview && this.state.overview.subjects) {
        this.state.overview.subjects.forEach(s => {
          const count = statsByPart[s.name] ? statsByPart[s.name].count : 0;
          const shortName = this.getSubjectShortName(s.name);
          const sel = s.name === currentPart ? 'selected' : '';
          partHtml += `<option value="${s.name}" ${sel}>${shortName} (${count}题)</option>`;
        });
      } else {
        Object.entries(statsByPart).forEach(([pName, pStat]) => {
          const shortName = this.getSubjectShortName(pName);
          const sel = pName === currentPart ? 'selected' : '';
          partHtml += `<option value="${pName}" ${sel}>${shortName} (${pStat.count}题)</option>`;
        });
      }
      pSelect.innerHTML = partHtml;
    }

    this.populateMistakeChapterOptions(statsByPart, totalAllCount);
    this.updateMistakesTrainingBtn(this.state.mistakesList.length);
  },

  populateMistakeChapterOptions(statsByPart, totalAllCount) {
    const chSelect = document.getElementById('mChapterFilter');
    if (!chSelect) return;

    const currentPart = this.state.filterPart || '';
    const currentChapter = this.state.filterChapter || '';

    let chHtml = '';
    if (currentPart && statsByPart && statsByPart[currentPart]) {
      const pStat = statsByPart[currentPart];
      chHtml += `<option value="">全部章节 (${pStat.count}题)</option>`;
      Object.entries(pStat.chapters).forEach(([chName, count]) => {
        const sel = chName === currentChapter ? 'selected' : '';
        chHtml += `<option value="${chName}" ${sel}>${chName} (${count}题)</option>`;
      });
    } else {
      chHtml += `<option value="">全部章节 (${totalAllCount}题)</option>`;
      if (statsByPart) {
        Object.entries(statsByPart).forEach(([pName, pStat]) => {
          const shortPart = this.getSubjectShortName(pName);
          Object.entries(pStat.chapters).forEach(([chName, count]) => {
            const sel = chName === currentChapter ? 'selected' : '';
            chHtml += `<option value="${chName}" ${sel}>${shortPart} · ${chName} (${count}题)</option>`;
          });
        });
      }
    }
    chSelect.innerHTML = chHtml;
  },

  onPartFilterChange() {
    const pSelect = document.getElementById('mPartFilter');
    this.state.filterPart = pSelect ? pSelect.value : '';
    this.state.filterChapter = '';
    this.loadMistakes();
  },

  onChapterFilterChange() {
    const chSelect = document.getElementById('mChapterFilter');
    this.state.filterChapter = chSelect ? chSelect.value : '';
    this.loadMistakes();
  },

  filterMistakes() {
    this.onPartFilterChange();
  },

  updateMistakesTrainingBtn(count) {
    const btn = document.getElementById('btnStartMistakesTraining');
    if (!btn) return;

    const part = this.state.filterPart || '';
    const chapter = this.state.filterChapter || '';

    if (part && chapter) {
      const shortPart = this.getSubjectShortName(part);
      const shortCh = chapter.length > 10 ? chapter.slice(0, 9) + '…' : chapter;
      btn.innerHTML = `⚡ 专项特训【${shortPart}·${shortCh}】(${count}题)`;
    } else if (part) {
      const shortPart = this.getSubjectShortName(part);
      btn.innerHTML = `⚡ 专项特训【${shortPart}】(${count}题)`;
    } else {
      btn.innerHTML = `⚡ 立即全部错题特训 (${count}题)`;
    }

    btn.disabled = (count === 0);
    btn.style.opacity = count === 0 ? '0.5' : '1';
    btn.style.cursor = count === 0 ? 'not-allowed' : 'pointer';
  },

  renderMistakesList() {
    const container = document.getElementById('mistakesListContainer');
    if (!container) return;

    if (!this.state.mistakesList.length) {
      container.innerHTML = `
        <div style="text-align:center; padding: 48px; color: var(--text-muted);">
          <h3>🎉 暂无待攻克错题！</h3>
          <p style="margin-top: 8px;">在沉浸刷题中做错的题目将自动收录在此处供你专项特训。</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.state.mistakesList.map((m) => {
      const userAns = (m.user_selected && m.user_selected.length > 0) ? m.user_selected.join('') : '未作答';
      const stdAns = m.answer || '—';
      const snippet = m.analysis ? m.analysis.slice(0, 120) + '...' : '';

      return `
        <div class="mistake-card-item">
          <div class="m-item-meta">
            <span class="p-subject-tag">${this.getSubjectShortName(m.part)}</span>
            <span class="p-chapter-tag">${m.chapter}</span>
            <span class="q-badge">第 ${m.num} 题</span>
            <span class="p-type-tag ${m.type === '单项选择题' ? 'type-single' : 'type-multi'}">${m.type}</span>
            ${m.source ? `<span style="font-size:11px; color:var(--accent-cyan);">${m.source}</span>` : ''}
          </div>

          <div class="m-item-stem">${m.stem}</div>

          <div class="m-item-answers">
            <span>你的作答: <strong style="color:var(--accent-coral)">${userAns}</strong></span>
            <span>标准答案: <strong style="color:var(--accent-green)">${stdAns}</strong></span>
          </div>

          ${snippet ? `<div class="m-item-expl-snippet"><strong>【简析要点】</strong> ${snippet}</div>` : ''}

          <div class="m-item-footer">
            <button type="button" class="btn-sm-action" data-action="master-mistake" data-qid="${m.id}">✓ 标为已攻克</button>
            <button type="button" class="btn-primary" style="font-size:12px; padding: 6px 14px;" data-action="retry-mistake" data-qid="${m.id}">
              ⚡ 重刷这道题
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  retrySingleMistake(qid) {
    let q = DB.questionsMap[qid];
    if (!q) {
      const num = parseInt(String(qid).replace(/\D/g, ''), 10);
      if (!isNaN(num)) {
        const padId = `Q_${String(num).padStart(4, '0')}`;
        q = DB.questionsMap[padId] || (DB.questionsData && DB.questionsData.questions.find(item => item.num === num));
      }
    }
    if (!q) return;
    this.state.currentPart = q.part;
    this.state.currentChapter = q.chapter;
    this.state.currentType = '';
    this.state.practiceMode = 'instant';
    this.state.currentIndex = 0;
    this.state.explanationVisible = true;

    const shortSub = this.getSubjectShortName(q.part);
    this.updateBreadcrumb(`${shortSub} · 错题精练`);

    const qCopy = { ...q, user_selected: [], user_time: 0, is_flagged: false, is_correct: null, in_mistakes: true };
    this.state.questions = [qCopy];

    this.navigateTo('practice');
    this.updateModePillsUI();
    this.renderQuestion();
  },

  markMistakeMastered(qid) {
    DB.mistakeAction(qid, 'master');
    this.loadMistakes();
    this.loadOverview();
  },

  startMistakesTraining() {
    if (!this.state.mistakesList.length) {
      this.showToast('🎉 当前筛选条件下暂无待攻克错题！', 'info', 2800);
      return;
    }
    const part = this.state.filterPart || '';
    const chapter = this.state.filterChapter || '';
    this.startPractice(part, chapter, '', 'mistakes_only');
  }
};
