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

// 辅助：标准化为紧凑错题格式 [count, lastChoice, time, mastered (1|0)]
function toCompactMistake(item) {
  if (!item) return null;
  if (Array.isArray(item)) {
    return [
      item[0] || 1,
      item[1] || '',
      item[2] || 0,
      item[3] ? 1 : 0
    ];
  }
  return [
    item.count || item.wrong_count || 1,
    item.lastChoice || (Array.isArray(item.last_selected) ? item.last_selected.join('') : (item.last_selected || '')),
    item.time || (item.last_wrong_time ? (Date.parse(item.last_wrong_time) || 0) : Date.now()),
    item.mastered ? 1 : 0
  ];
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
    const url = new URL(request.url);
    const clientTimeParam = url.searchParams.get('clientTime');
    const clientTime = clientTimeParam ? parseInt(clientTimeParam, 10) : 0;

    // 单次 LEFT JOIN 合并查询：同时检查用户存在性与获取进度，节省 50% D1 读取操作
    const row = await env.DB.prepare(`
      SELECT u.id AS uid, p.answers_data, p.mistakes_data, p.updated_at
      FROM users u
      LEFT JOIN user_progress p ON u.id = p.user_id
      WHERE u.id = ?
    `).bind(authUser.id).first();

    if (!row || !row.uid) {
      return jsonResponse({
        success: false,
        code: 'USER_DELETED',
        error: '账号在云端已被删除，本地数据将自动清空'
      }, 404);
    }

    const updatedAt = row.updated_at || 0;

    // 防无用下载：如果客户端带有本地版本时间戳，且云端更新时间未变动，返回轻量 notModified 响应
    if (clientTime > 0 && updatedAt > 0 && clientTime >= updatedAt) {
      return jsonResponse({
        success: true,
        notModified: true,
        updatedAt: updatedAt,
        message: '云端数据未发生变化'
      });
    }

    if (!row.updated_at) {
      return jsonResponse({
        success: true,
        answers: {},
        mistakes: {},
        updatedAt: 0
      });
    }

    let answers = {};
    let mistakes = {};

    try { answers = JSON.parse(row.answers_data || '{}'); } catch(e) {}
    try { mistakes = JSON.parse(row.mistakes_data || '{}'); } catch(e) {}

    return jsonResponse({
      success: true,
      answers,
      mistakes,
      updatedAt: row.updated_at
    });
  } catch (err) {
    return errorResponse(`拉取云端进度失败: ${err.message || err}`, 500);
  }
}

// POST: 双向智能合并本地与云端做题数据并保存至 D1（带防重复写入校验）
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

  const { answers: localAnswers, mistakes: localMistakes } = body || {};

  try {
    // 单次 LEFT JOIN 查询：确认用户存活并获取现有进度
    const existing = await env.DB.prepare(`
      SELECT u.id AS uid, p.updated_at, p.answers_data, p.mistakes_data
      FROM users u
      LEFT JOIN user_progress p ON u.id = p.user_id
      WHERE u.id = ?
    `).bind(authUser.id).first();

    if (!existing || !existing.uid) {
      return jsonResponse({
        success: false,
        code: 'USER_DELETED',
        error: '账号在云端已被删除，本地数据将自动清空'
      }, 404);
    }

    // 权威保存（全量快照覆盖）：直接将客户端传来的当前做题状态作为云端权威最新数据
    const cleanAnswers = {};
    for (const [qid, item] of Object.entries(localAnswers || {})) {
      const compact = toCompactAnswer(item);
      if (compact) cleanAnswers[qid] = compact;
    }

    const cleanMistakes = {};
    for (const [qid, item] of Object.entries(localMistakes || {})) {
      const compact = toCompactMistake(item);
      if (compact) cleanMistakes[qid] = compact;
    }

    const answersJson = JSON.stringify(cleanAnswers);
    const mistakesJson = JSON.stringify(cleanMistakes);

    // 服务端二次拦截：如果数据库中已有记录，且内容完全一致，跳过 D1 写入！
    if (existing.answers_data === answersJson && existing.mistakes_data === mistakesJson) {
      return jsonResponse({
        success: true,
        notModified: true,
        answers: cleanAnswers,
        mistakes: cleanMistakes,
        updatedAt: existing.updated_at || Date.now(),
        message: '数据与云端一致，无需重复写入'
      });
    }

    const now = Date.now();

    // 写入 D1 (INSERT or REPLACE 快照)
    await env.DB.prepare(
      `INSERT INTO user_progress (user_id, answers_data, mistakes_data, stats_data, version, updated_at)
       VALUES (?, ?, ?, '{}', 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         answers_data = excluded.answers_data,
         mistakes_data = excluded.mistakes_data,
         updated_at = excluded.updated_at`
    ).bind(authUser.id, answersJson, mistakesJson, now).run();

    return jsonResponse({
      success: true,
      answers: cleanAnswers,
      mistakes: cleanMistakes,
      updatedAt: now,
      message: '云端做题数据保存成功'
    });
  } catch (err) {
    return errorResponse(`同步做题数据失败: ${err.message || err}`, 500);
  }
}
