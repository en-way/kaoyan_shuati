/**
 * 解析面板共享渲染层 (js/ui/explanation-renderer.js)
 * 消除移动端/单栏内嵌解析卡片 (#explanationPanel) 与桌面端右侧粘性解析面板 (#desktopSidePanel) 的重复渲染逻辑。
 */

/**
 * 计算当前状态下是否应展示答案与解析
 * @param {object} state - App.state
 * @returns {boolean}
 */
export function computeExplanationVisibility(state) {
  const mode = state.practiceMode;
  if (mode === 'recite' || mode === 'exam_review') {
    return Boolean(state.explanationVisible);
  }
  if (mode === 'instant' || mode === 'mistakes_only') {
    if (state.isEvaluated) {
      return Boolean(state.explanationVisible);
    }
    return Boolean(state.manualPeek);
  }
  return false;
}

/**
 * 统一填充解析 DOM 字段（标准答案、考点出处、核心简析、名师点拨）
 * @param {object} q - 当前题目对象
 * @param {object} ids - 目标 DOM 元素 ID 映射
 */
export function populateExplanationFields(q, ids) {
  const ansEl = document.getElementById(ids.ansId);
  if (ansEl) ansEl.textContent = q.answer || '—';

  const srcWrap = document.getElementById(ids.srcWrapId);
  if (q.source) {
    if (srcWrap) srcWrap.style.display = 'flex';
    const srcText = document.getElementById(ids.srcTextId);
    if (srcText) srcText.textContent = q.source;
  } else if (srcWrap) {
    srcWrap.style.display = 'none';
  }

  const analysisText = document.getElementById(ids.analysisId);
  if (analysisText) analysisText.textContent = q.analysis || '暂无解析';

  const tipsWrap = document.getElementById(ids.tipsWrapId);
  if (q.tips) {
    if (tipsWrap) tipsWrap.style.display = 'flex';
    const tipsText = document.getElementById(ids.tipsTextId);
    if (tipsText) tipsText.textContent = q.tips;
  } else if (tipsWrap) {
    tipsWrap.style.display = 'none';
  }
}

export const explanationMethods = {
  renderExplanationPanel(q) {
    const panel = document.getElementById('explanationPanel');
    const isVisible = computeExplanationVisibility(this.state);

    if (panel) {
      if (!isVisible || !q) {
        panel.style.display = 'none';
      } else {
        panel.style.display = 'flex';
        populateExplanationFields(q, {
          ansId: 'explAnswerVal',
          srcWrapId: 'explSourceWrap',
          srcTextId: 'explSourceText',
          analysisId: 'explAnalysisText',
          tipsWrapId: 'explTipsWrap',
          tipsTextId: 'explTipsText'
        });
      }
    }

    this.renderSideExplanationPanel(q, isVisible);
  },

  renderSideExplanationPanel(q, isVisible) {
    const sidePanel = document.getElementById('desktopSidePanel');
    if (!sidePanel) return;

    const mode = this.state.practiceMode;
    const placeholder = document.getElementById('sideExplPlaceholder');
    const active = document.getElementById('sideExplActive');
    const exam = document.getElementById('sideExamCard');

    if (!q) {
      if (placeholder) placeholder.style.display = 'flex';
      if (active) active.style.display = 'none';
      if (exam) exam.style.display = 'none';
      return;
    }

    if (mode === 'exam') {
      if (placeholder) placeholder.style.display = 'none';
      if (active) active.style.display = 'none';
      if (exam) {
        exam.style.display = 'flex';
        const curNumEl = document.getElementById('sideExamCurNum');
        if (curNumEl) curNumEl.textContent = `${this.state.currentIndex + 1} / ${this.state.questions.length}`;
        const answeredCount = this.state.questions.filter(item => item.user_selected && item.user_selected.length > 0).length;
        const countEl = document.getElementById('sideExamAnsweredCount');
        if (countEl) countEl.textContent = `${answeredCount} 题`;
        const rulesEl = document.getElementById('sideExamRulesList');
        if (rulesEl) {
          const singleCnt = this.state.questions.filter(item => item.type === '单项选择题').length;
          const multiCnt = Math.max(0, this.state.questions.length - singleCnt);
          rulesEl.innerHTML = `
            <div class="rule-item">✓ 本章单选 ${singleCnt} 题，每题 1 分</div>
            <div class="rule-item">✓ 本章多选 ${multiCnt} 题，每题 2 分</div>
            <div class="rule-item">✓ 支持点击题卡快速跳题检查</div>
          `;
        }
      }
      return;
    }

    if (exam) exam.style.display = 'none';

    if (isVisible) {
      if (placeholder) placeholder.style.display = 'none';
      if (active) {
        active.style.display = 'flex';
        populateExplanationFields(q, {
          ansId: 'sideExplAnswerVal',
          srcWrapId: 'sideExplSourceWrap',
          srcTextId: 'sideExplSourceText',
          analysisId: 'sideExplAnalysisText',
          tipsWrapId: 'sideExplTipsWrap',
          tipsTextId: 'sideExplTipsText'
        });

        const banner = document.getElementById('sideResultBanner');
        const resIcon = document.getElementById('sideResultIcon');
        const resText = document.getElementById('sideResultText');
        if (banner) {
          if (this.state.isEvaluated && q.is_correct !== null && q.is_correct !== undefined) {
            banner.style.display = 'flex';
            if (q.is_correct) {
              banner.className = 'side-result-banner is-correct';
              if (resIcon) resIcon.textContent = '✓';
              if (resText) resText.textContent = `回答正确！你的选择: ${(q.user_selected || []).join('')}`;
            } else {
              banner.className = 'side-result-banner is-wrong';
              if (resIcon) resIcon.textContent = '✗';
              const selStr = (q.user_selected || []).join('') || '未作答';
              if (resText) resText.textContent = `回答错误。你的选择: ${selStr}，标准答案: ${q.answer}`;
            }
          } else {
            banner.style.display = 'none';
          }
        }

        const sideFlagIcon = document.getElementById('sideFlagIcon');
        if (sideFlagIcon) sideFlagIcon.textContent = this.state.isFlagged ? '★' : '☆';
      }
    } else {
      if (active) active.style.display = 'none';
      if (placeholder) placeholder.style.display = 'flex';
    }
  },

  toggleExplanationFold() {
    const mode = this.state.practiceMode;
    if (this.state.isEvaluated || mode === 'recite') {
      this.state.explanationVisible = !this.state.explanationVisible;
    } else {
      this.state.manualPeek = !this.state.manualPeek;
    }
    const q = this.getCurrentQuestion();
    if (q) this.renderExplanationPanel(q);
  }
};
