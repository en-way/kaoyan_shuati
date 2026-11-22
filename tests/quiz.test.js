import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeSelection,
  evaluateAnswer,
  encodeCompactAnswer,
  decodeCompactAnswer,
  encodeCompactMistake,
  decodeCompactMistake,
  toCompactPayload,
  mergeFromCompactPayload,
  computeOverview,
  filterQuestions,
  computeMistakesList,
  computeDataFingerprint
} from '../js/core/quiz.js';
import { gradeChapterExam, formatSeconds } from '../js/core/exam.js';

const sampleBank = JSON.parse(fs.readFileSync(new URL('../data/questions.sample.json', import.meta.url), 'utf8'));

describe('js/core/quiz.js & js/core/exam.js 纯函数判题与统计引擎', () => {
  it('normalizeSelection: 应去重、忽略空白、转大写并按字母序排列', () => {
    assert.equal(normalizeSelection(['c', 'A', 'b', 'A']), 'ABC');
    assert.equal(normalizeSelection('dbca'), 'ABCD');
    assert.equal(normalizeSelection([]), '');
    assert.equal(normalizeSelection(null), '');
  });

  it('evaluateAnswer: 单选与多选判题及空选项边界处理', () => {
    const singleQ = { id: 'Q_0001', type: '单项选择题', answer: 'B' };
    const multiQ = { id: 'Q_0002', type: '多项选择题', answer: 'ABD' };

    assert.deepEqual(evaluateAnswer(singleQ, ['B'], true), {
      userStr: 'B',
      stdAns: 'B',
      isCorrect: true
    });
    assert.deepEqual(evaluateAnswer(singleQ, ['A'], true), {
      userStr: 'A',
      stdAns: 'B',
      isCorrect: false
    });
    assert.deepEqual(evaluateAnswer(multiQ, ['D', 'A', 'B'], true), {
      userStr: 'ABD',
      stdAns: 'ABD',
      isCorrect: true
    });
    assert.deepEqual(evaluateAnswer(multiQ, ['A', 'B'], true), {
      userStr: 'AB',
      stdAns: 'ABD',
      isCorrect: false
    });
    // 空选项或模考暂不判分时 isCorrect 应为 null
    assert.equal(evaluateAnswer(singleQ, [], true).isCorrect, null);
    assert.equal(evaluateAnswer(multiQ, ['A', 'B', 'D'], false).isCorrect, null);
  });

  it('紧凑数组编解码: encodeCompactAnswer / decodeCompactAnswer / encodeCompactMistake / decodeCompactMistake', () => {
    const t = 1760000000000;
    const iso = new Date(t).toISOString();
    const compactAns = encodeCompactAnswer({
      selected: ['D', 'A', 'B'],
      is_correct: true,
      is_flagged: true,
      updated_at: iso
    });
    assert.deepEqual(compactAns, ['ABD', 1, t, 1]);

    const decodedAns = decodeCompactAnswer(compactAns, { time_spent: 15 });
    assert.deepEqual(decodedAns, {
      selected: ['A', 'B', 'D'],
      is_correct: true,
      is_flagged: true,
      time_spent: 15,
      updated_at: iso
    });

    const compactMis = encodeCompactMistake({
      wrong_count: 3,
      last_selected: ['C', 'A'],
      last_wrong_time: iso,
      mastered: false
    });
    assert.deepEqual(compactMis, [3, 'AC', t, 0]);

    const decodedMis = decodeCompactMistake(compactMis, 'Q_0002');
    assert.equal(decodedMis.wrong_count, 3);
    assert.deepEqual(decodedMis.last_selected, ['A', 'C']);
    assert.equal(decodedMis.mastered, false);
  });

  it('mergeFromCompactPayload: 应按单题最新时间戳合并多端记录', () => {
    const localData = {
      answers: {
        Q_0001: { selected: ['A'], is_correct: false, is_flagged: false, updated_at: new Date(1000).toISOString() },
        Q_0002: { selected: ['A', 'B', 'D'], is_correct: true, is_flagged: true, updated_at: new Date(5000).toISOString() }
      },
      mistakes: {}
    };
    const cloudData = {
      answers: {
        Q_0001: ['B', 1, 3000, 0], // 比本地新 (3000 > 1000) -> 应覆盖本地
        Q_0002: ['AB', 0, 2000, 0] // 比本地旧 (2000 < 5000) -> 应保留本地
      },
      mistakes: {
        Q_0003: [2, 'C', 4000, 0]
      }
    };

    const merged = mergeFromCompactPayload(localData, cloudData);
    assert.deepEqual(merged.answers.Q_0001.selected, ['B']);
    assert.equal(merged.answers.Q_0001.is_correct, true);
    assert.deepEqual(merged.answers.Q_0002.selected, ['A', 'B', 'D']);
    assert.equal(merged.answers.Q_0002.is_correct, true);
    assert.equal(merged.mistakes.Q_0003.wrong_count, 2);
  });

  it('computeOverview / filterQuestions / computeMistakesList / gradeChapterExam: 统计与模考评分', () => {
    const userData = {
      answers: {
        Q_0001: { selected: ['B'], is_correct: true },
        Q_0002: { selected: ['A', 'C'], is_correct: false }
      },
      mistakes: {
        Q_0002: { question_id: 'Q_0002', wrong_count: 1, last_selected: ['A', 'C'], mastered: false }
      }
    };

    const overview = computeOverview(sampleBank, userData);
    assert.equal(overview.total_questions, 5);
    assert.equal(overview.total_answered, 2);
    assert.equal(overview.total_correct, 1);
    assert.equal(overview.total_mistakes, 1);
    assert.equal(overview.overall_accuracy, 50);

    // 错题筛选
    const qMap = Object.fromEntries(sampleBank.questions.map(q => [q.id, q]));
    const mistakesRes = computeMistakesList(qMap, userData);
    assert.equal(mistakesRes.count, 1);
    assert.equal(mistakesRes.mistakes[0].id, 'Q_0002');

    // 模考模式应隐藏标准答案与解析
    const examFiltered = filterQuestions(sampleBank, userData, {
      part: '第一部分 马克思主义基本原理',
      chapter: '导论',
      mode: 'exam'
    });
    assert.equal(examFiltered.count, 2);
    assert.equal(examFiltered.questions[0].answer, null);
    assert.equal(examFiltered.questions[0].analysis, null);

    // 章节模考交卷评分：Q_0001 (单选 1分 对) + Q_0002 (多选 2分 错) = 1 / 3 分 (33.3%)
    const examReport = gradeChapterExam(sampleBank, userData, '第一部分 马克思主义基本原理', '导论');
    assert.equal(examReport.total, 2);
    assert.equal(examReport.total_points, 3);
    assert.equal(examReport.earned_points, 1);
    assert.equal(examReport.score_rate, 33.3);
    assert.equal(formatSeconds(125), '02:05');

    const fp1 = computeDataFingerprint(toCompactPayload(userData));
    const fp2 = computeDataFingerprint(toCompactPayload(userData));
    assert.equal(fp1, fp2);
  });
});
