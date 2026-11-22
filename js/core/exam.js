/**
 * 模考组卷与计分纯业务引擎 (js/core/exam.js)
 * 零 DOM 依赖，遵循考研政治官方赋分标准（单项选择题 1 分，多项选择题 2 分）。
 */
import { normalizeSelection } from './quiz.js';

/**
 * 章节模考交卷批量判分与错题本更新
 * @param {object} questionsData 题库对象
 * @param {object} userData 用户记录对象 ({ answers, mistakes })
 * @param {string} part 板块名
 * @param {string} chapter 章节名
 * @param {string} nowIso 当前 ISO 时间字符串
 */
export function gradeChapterExam(questionsData, userData, part, chapter, nowIso = new Date().toISOString()) {
  const allQuestions = (questionsData && questionsData.questions) || [];
  const chQuestions = allQuestions.filter(q => (!part || q.part === part) && (!chapter || q.chapter === chapter));

  if (!userData.answers) userData.answers = {};
  if (!userData.mistakes) userData.mistakes = {};

  let correctCnt = 0;
  let wrongCnt = 0;
  let unansweredCnt = 0;
  let totalPoints = 0;
  let earnedPoints = 0;
  const results = [];

  for (const q of chQuestions) {
    const qid = q.id;
    const rec = userData.answers[qid] || {};
    const selected = rec.selected || [];
    const userStr = normalizeSelection(selected);
    const stdAns = normalizeSelection(q.answer || '');
    const isMulti = q.type === '多项选择题' || q.type === '多选题' || (stdAns && stdAns.length > 1);
    const pointWeight = isMulti ? 2 : 1;
    totalPoints += pointWeight;

    let isCorr = false;
    let scoreEarned = 0;
    if (!userStr) {
      unansweredCnt++;
      // 模考未答题仅在成绩单中计 0 分，不污染日常 userData.answers
    } else {
      if (userStr === stdAns) {
        correctCnt++;
        isCorr = true;
        scoreEarned = pointWeight;
        earnedPoints += pointWeight;
        rec.is_correct = true;
        if (userData.mistakes[qid]) userData.mistakes[qid].mastered = true;
      } else {
        wrongCnt++;
        isCorr = false;
        rec.is_correct = false;
        if (!userData.mistakes[qid]) {
          userData.mistakes[qid] = { question_id: qid, wrong_count: 0 };
        }
        userData.mistakes[qid].wrong_count = (userData.mistakes[qid].wrong_count || 0) + 1;
        userData.mistakes[qid].last_selected = selected;
        userData.mistakes[qid].standard_answer = stdAns;
        userData.mistakes[qid].mastered = false;
        userData.mistakes[qid].last_wrong_time = nowIso;
      }

      rec.is_correct = isCorr;
      rec.updated_at = nowIso;
      userData.answers[qid] = rec;
    }

    results.push({
      id: qid,
      num: q.num,
      type: q.type || (isMulti ? '多项选择题' : '单项选择题'),
      stem: q.stem,
      user_ans: userStr || '未作答',
      standard_ans: stdAns,
      is_correct: isCorr,
      max_score: pointWeight,
      score_earned: scoreEarned,
      source: q.source || '',
      analysis: q.analysis || '',
      tips: q.tips || '',
      tag: q.tag || ''
    });
  }

  const totalGraded = correctCnt + wrongCnt;
  const scoreRate = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 1000) / 10 : 0;
  const accuracy = totalGraded > 0 ? Math.round((correctCnt / totalGraded) * 1000) / 10 : 0;

  return {
    success: true,
    total: chQuestions.length,
    correct_count: correctCnt,
    wrong_count: wrongCnt,
    unanswered_count: unansweredCnt,
    total_points: totalPoints,
    earned_points: earnedPoints,
    accuracy,
    score_rate: scoreRate,
    results
  };
}

/**
 * 秒数转 MM:SS 格式化纯函数
 */
export function formatSeconds(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}
