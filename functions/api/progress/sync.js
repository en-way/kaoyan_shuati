import {
  getAuthUser,
  jsonResponse,
  errorResponse
} from '../../utils/auth.js';

export async function onRequestOptions() {
  return jsonResponse({}, 200);
}

// 辅助：从作答条目中提取时间戳（兼容数组紧凑格式 [choice, isCorrect, time] 与对象格式）
function getItemTime(item) {
  if (!item) return 0;
  if (Array.isArray(item)) return item[2] || 0;
  if (typeof item === 'object') return item.time || 0;
  return 0;
}

// 辅助：标准化为紧凑数组格式 [choice, isCorrect ? 1 : 0, time]
function toCompactAnswer(item) {
  if (!item) return null;
  if (Array.isArray(item)) return item;
  return [
    item.choice || '',
    item.correct ? 1 : 0,
    item.time || Date.now()
  ];
}

// 辅助：标准化为紧凑错题格式 [count, lastChoice, time]
function toCompactMistake(item) {
  if (!item) return null;
  if (Array.isArray(item)) return item;
  return [
    item.count || 1,
    item.lastChoice || '',
    item.time || Date.now()
  ];
}

// 智能按时间戳合并作答记录
function mergeCompactAnswers(cloudMap, localMap) {
  const merged = { ...(cloudMap || {}) };
  for (const [qid, localItem] of Object.entries(localMap || {})) {
    const compactLocal = toCompactAnswer(localItem);
    if (!compactLocal) continue;

    const cloudItem = merged[qid];
    if (!cloudItem) {
      merged[qid] = compactLocal;
    } else {
      const localTime = getItemTime(compactLocal);
      const cloudTime = getItemTime(cloudItem);
      if (localTime >= cloudTime) {
        merged[qid] = compactLocal;
      }
    }
  }
  return merged;
}

// 智能按时间戳合并错题记录
function mergeCompactMistakes(cloudMap, localMap) {
  const merged = { ...(cloudMap || {}) };
  for (const [qid, localItem] of Object.entries(localMap || {})) {
    const compactLocal = toCompactMistake(localItem);
    if (!compactLocal) continue;

    const cloudItem = merged[qid];
    if (!cloudItem) {
      merged[qid] = compactLocal;
    } else {
      const localTime = getItemTime(compactLocal);
      const cloudTime = getItemTime(cloudItem);
      if (localTime >= cloudTime) {
        merged[qid] = compactLocal;
      }
    }
  }
  return merged;
}

// GET: 拉取云端最新刷题进度
export async function onRequestGet(context) {
  const { request, env } = context;

  const authUser = await getAuthUser(request, env);
  if (!authUser) {
    return errorResponse('未登录或登录已失效，请先登录', 401);
  }

  if (!env.DB) {
    return errorResponse('Cloudflare D1 数据库未绑定', 500);
  }

  try {
    // 检查用户是否仍在 users 表中
    const userExists = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(authUser.id).first();
    if (!userExists) {
      return jsonResponse({
        success: false,
        code: 'USER_DELETED',
        error: '账号在云端已被删除，本地数据将自动清空'
      }, 404);
    }

    const progressRow = await env.DB.prepare(
      'SELECT answers_data, mistakes_data, stats_data, updated_at FROM user_progress WHERE user_id = ?'
    ).bind(authUser.id).first();

    if (!progressRow) {
      return jsonResponse({
        success: true,
        answers: {},
        mistakes: {},
        stats: {},
        updatedAt: 0
      });
    }

    let answers = {};
    let mistakes = {};
    let stats = {};

    try { answers = JSON.parse(progressRow.answers_data || '{}'); } catch(e) {}
    try { mistakes = JSON.parse(progressRow.mistakes_data || '{}'); } catch(e) {}
    try { stats = JSON.parse(progressRow.stats_data || '{}'); } catch(e) {}

    return jsonResponse({
      success: true,
      answers,
      mistakes,
      stats,
      updatedAt: progressRow.updated_at
    });
  } catch (err) {
    return errorResponse(`拉取云端进度失败: ${err.message || err}`, 500);
  }
}

// POST: 双向智能合并本地与云端做题数据并保存至 D1
export async function onRequestPost(context) {
  const { request, env } = context;

  const authUser = await getAuthUser(request, env);
  if (!authUser) {
    return errorResponse('未登录或登录已失效，请先登录', 401);
  }

  if (!env.DB) {
    return errorResponse('Cloudflare D1 数据库未绑定', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('请求参数格式错误 (需为 JSON)', 400);
  }

  const { answers: localAnswers, mistakes: localMistakes, stats: localStats } = body || {};

  try {
    // 检查用户是否仍在 users 表中
    const userExists = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(authUser.id).first();
    if (!userExists) {
      return jsonResponse({
        success: false,
        code: 'USER_DELETED',
        error: '账号在云端已被删除，本地数据将自动清空'
      }, 404);
    }

    // 1. 读取云端现有进度
    const existingRow = await env.DB.prepare(
      'SELECT answers_data, mistakes_data, stats_data FROM user_progress WHERE user_id = ?'
    ).bind(authUser.id).first();

    let cloudAnswers = {};
    let cloudMistakes = {};
    let cloudStats = {};

    if (existingRow) {
      try { cloudAnswers = JSON.parse(existingRow.answers_data || '{}'); } catch(e) {}
      try { cloudMistakes = JSON.parse(existingRow.mistakes_data || '{}'); } catch(e) {}
      try { cloudStats = JSON.parse(existingRow.stats_data || '{}'); } catch(e) {}
    }

    // 2. 智能基于时间戳合并
    const finalAnswers = mergeCompactAnswers(cloudAnswers, localAnswers);
    const finalMistakes = mergeCompactMistakes(cloudMistakes, localMistakes);
    const finalStats = { ...cloudStats, ...(localStats || {}) };

    const now = Date.now();
    const answersJson = JSON.stringify(finalAnswers);
    const mistakesJson = JSON.stringify(finalMistakes);
    const statsJson = JSON.stringify(finalStats);

    // 3. 写入 D1 (INSERT or REPLACE)
    await env.DB.prepare(
      `INSERT INTO user_progress (user_id, answers_data, mistakes_data, stats_data, version, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         answers_data = excluded.answers_data,
         mistakes_data = excluded.mistakes_data,
         stats_data = excluded.stats_data,
         updated_at = excluded.updated_at`
    ).bind(authUser.id, answersJson, mistakesJson, statsJson, now).run();

    return jsonResponse({
      success: true,
      answers: finalAnswers,
      mistakes: finalMistakes,
      stats: finalStats,
      updatedAt: now,
      message: '云端同步成功'
    });
  } catch (err) {
    return errorResponse(`同步做题数据失败: ${err.message || err}`, 500);
  }
}
