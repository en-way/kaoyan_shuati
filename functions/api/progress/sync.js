import {
  getAuthUser,
  jsonResponse,
  errorResponse
} from '../../utils/auth.js';
import { readJsonBody, handleError } from '../../utils/http.js';
import { MAX_SYNC_BODY_BYTES } from '../../utils/constants.js';
import { resolveBankId } from '../../utils/validate.js';

export async function onRequestOptions() {
  return jsonResponse({}, 200);
}

// 辅助：从作答条目中提取时间戳（兼容紧凑数组 [choice, isCorrect, time, isFlagged] 与对象格式）
export function getItemTime(item) {
  if (!item) return 0;
  if (Array.isArray(item)) return Number.isFinite(item[2]) ? item[2] : 0;
  if (typeof item === 'object') {
    if (Number.isFinite(item.time)) return item.time;
    if (item.time && !isNaN(Date.parse(item.time))) return Date.parse(item.time);
    if (item.updated_at && !isNaN(Date.parse(item.updated_at))) return Date.parse(item.updated_at);
    if (item.last_wrong_time && !isNaN(Date.parse(item.last_wrong_time))) return Date.parse(item.last_wrong_time);
  }
  return 0;
}

// 辅助：标准化为紧凑数组格式 [choice, isCorrect (-1|0|1), time, isFlagged (1|0)]
export function toCompactAnswer(item) {
  if (!item) return null;
  if (Array.isArray(item)) {
    const choice = typeof item[0] === 'string' ? item[0] : '';
    const isCorr = item[1] === 1 ? 1 : (item[1] === 0 ? 0 : -1);
    const time = Number.isFinite(item[2]) ? item[2] : Date.now();
    const isFlagged = item[3] ? 1 : 0;
    return [choice, isCorr, time, isFlagged];
  }
  const choice = Array.isArray(item.choice) ? item.choice.join('') : (Array.isArray(item.selected) ? item.selected.join('') : (item.choice || item.selected || ''));
  const isCorr = (item.is_correct === true || item.correct === true) ? 1 : ((item.is_correct === false || item.correct === false) ? 0 : -1);
  const time = Number.isFinite(item.time) ? item.time : (item.time && !isNaN(Date.parse(item.time)) ? Date.parse(item.time) : (item.updated_at && !isNaN(Date.parse(item.updated_at)) ? Date.parse(item.updated_at) : Date.now()));
  const isFlagged = (item.is_flagged || item.flagged) ? 1 : 0;
  return [typeof choice === 'string' ? choice : '', isCorr, time, isFlagged];
}

// 辅助：标准化为紧凑错题格式 [count, lastChoice, time, mastered (1|0)]
export function toCompactMistake(item) {
  if (!item) return null;
  if (Array.isArray(item)) {
    return [
      Number.isFinite(item[0]) ? item[0] : 1,
      typeof item[1] === 'string' ? item[1] : '',
      Number.isFinite(item[2]) ? item[2] : 0,
      item[3] ? 1 : 0
    ];
  }
  const count = Number.isFinite(item.count) ? item.count : (Number.isFinite(item.wrong_count) ? item.wrong_count : 1);
  const lastChoice = item.lastChoice || (Array.isArray(item.last_selected) ? item.last_selected.join('') : (item.last_selected || ''));
  const time = Number.isFinite(item.time) ? item.time : (item.time && !isNaN(Date.parse(item.time)) ? Date.parse(item.time) : (item.last_wrong_time && !isNaN(Date.parse(item.last_wrong_time)) ? Date.parse(item.last_wrong_time) : Date.now()));
  const mastered = item.mastered ? 1 : 0;
  return [count, typeof lastChoice === 'string' ? lastChoice : '', time, mastered];
}

const validQid = (qid) =>
  typeof qid === 'string' &&
  qid.length > 0 &&
  qid.length <= 64 &&
  /^[a-zA-Z0-9_-]+$/.test(qid) &&
  qid !== '__proto__' &&
  qid !== 'constructor';

// GET: 拉取指定题库 (bankId，默认 '2027_1000') 的云端最新刷题进度
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
    const bankId = resolveBankId(url.searchParams.get('bankId'));
    const clientTimeParam = url.searchParams.get('clientTime');
    const clientTime = clientTimeParam ? parseInt(clientTimeParam, 10) : 0;

    // 单次 LEFT JOIN 合并查询：同时检查用户存在性与获取该题库进度，节省 50% D1 读取操作
    const row = await env.DB.prepare(`
      SELECT u.id AS uid, p.answers_data, p.mistakes_data, p.version, p.updated_at
      FROM users u
      LEFT JOIN user_progress p ON u.id = p.user_id AND p.bank_id = ?
      WHERE u.id = ?
    `).bind(bankId, authUser.id).first();

    if (!row || !row.uid) {
      return jsonResponse({
        success: false,
        code: 'USER_DELETED',
        error: '账号在云端已被删除'
      }, 404);
    }

    const updatedAt = row.updated_at || 0;
    const version = Number.isFinite(row.version) && row.version > 0 ? row.version : 1;

    // 防无用下载：如果客户端带有本地版本时间戳，且云端更新时间未变动，返回轻量 notModified 响应
    if (clientTime > 0 && updatedAt > 0 && clientTime >= updatedAt) {
      return jsonResponse({
        success: true,
        notModified: true,
        bankId,
        version,
        updatedAt,
        message: '云端数据未发生变化'
      });
    }

    if (!row.updated_at) {
      return jsonResponse({
        success: true,
        bankId,
        version: 1,
        answers: {},
        mistakes: {},
        updatedAt: 0
      });
    }

    let answers = {};
    let mistakes = {};

    try { answers = JSON.parse(row.answers_data || '{}'); } catch (e) {}
    try { mistakes = JSON.parse(row.mistakes_data || '{}'); } catch (e) {}

    return jsonResponse({
      success: true,
      bankId,
      version,
      answers,
      mistakes,
      updatedAt: row.updated_at
    });
  } catch (err) {
    return handleError(err, 'progress/sync:get');
  }
}

// POST: 多题库云端进度同步（支持单题时间戳智能合并、显式 overwrite 快照覆盖、version 乐观锁 409 检测）
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
    body = await readJsonBody(request, MAX_SYNC_BODY_BYTES);
  } catch (e) {
    return handleError(e, 'progress/sync:parse');
  }

  try {
    const url = new URL(request.url);
    const rawBankId = (body && body.bankId !== undefined) ? body.bankId : url.searchParams.get('bankId');
    const bankId = resolveBankId(rawBankId);

    const {
      answers: localAnswers,
      mistakes: localMistakes,
      overwrite = false
    } = body || {};

    const expectedVersionRaw = body && (body.expectedVersion !== undefined ? body.expectedVersion : body.version);
    const hasExpectedVersion = expectedVersionRaw !== undefined && expectedVersionRaw !== null && expectedVersionRaw !== '';
    const expectedVersion = hasExpectedVersion ? parseInt(expectedVersionRaw, 10) : null;

    // 单次 LEFT JOIN 查询：确认用户存活并获取该题库现有进度
    const existing = await env.DB.prepare(`
      SELECT u.id AS uid, p.version, p.updated_at, p.answers_data, p.mistakes_data
      FROM users u
      LEFT JOIN user_progress p ON u.id = p.user_id AND p.bank_id = ?
      WHERE u.id = ?
    `).bind(bankId, authUser.id).first();

    if (!existing || !existing.uid) {
      return jsonResponse({
        success: false,
        code: 'USER_DELETED',
        error: '账号在云端已被删除'
      }, 404);
    }

    const hasCloudRow = existing.updated_at !== null && existing.updated_at !== undefined;
    const cloudVersion = hasCloudRow && Number.isFinite(existing.version) && existing.version > 0 ? existing.version : 1;

    let cloudAnswers = {};
    let cloudMistakes = {};
    if (hasCloudRow) {
      try { cloudAnswers = JSON.parse(existing.answers_data || '{}'); } catch (e) {}
      try { cloudMistakes = JSON.parse(existing.mistakes_data || '{}'); } catch (e) {}
    }

    // 乐观锁冲突检测：当客户端显式携带 expectedVersion / version 且与云端已有版本不一致时，返回 409 Conflict
    if (hasExpectedVersion && Number.isFinite(expectedVersion) && hasCloudRow && expectedVersion !== cloudVersion) {
      return jsonResponse({
        success: false,
        code: 'VERSION_CONFLICT',
        error: '云端进度已在其他设备更新，请合并后重试',
        bankId,
        version: cloudVersion,
        updatedAt: existing.updated_at || 0,
        answers: cloudAnswers,
        mistakes: cloudMistakes
      }, 409);
    }

    // 规范化客户端上传的 answers 与 mistakes
    const sanitizedLocalAnswers = {};
    if (localAnswers && typeof localAnswers === 'object') {
      for (const [qid, item] of Object.entries(localAnswers)) {
        if (!validQid(qid)) continue;
        const compact = toCompactAnswer(item);
        if (compact) sanitizedLocalAnswers[qid] = compact;
      }
    }

    const sanitizedLocalMistakes = {};
    if (localMistakes && typeof localMistakes === 'object') {
      for (const [qid, item] of Object.entries(localMistakes)) {
        if (!validQid(qid)) continue;
        const compact = toCompactMistake(item);
        if (compact) sanitizedLocalMistakes[qid] = compact;
      }
    }

    let finalAnswers = {};
    let finalMistakes = {};

    if (overwrite === true) {
      // 显式快照权威覆盖模式（如重置章节、清空本地重做）
      finalAnswers = sanitizedLocalAnswers;
      finalMistakes = sanitizedLocalMistakes;
    } else {
      // 默认：单题最新时间戳双向智能合并（防止多设备做题互相冲掉进度）
      for (const [qid, item] of Object.entries(cloudAnswers)) {
        if (!validQid(qid)) continue;
        const compact = toCompactAnswer(item);
        if (compact) finalAnswers[qid] = compact;
      }
      for (const [qid, localCompact] of Object.entries(sanitizedLocalAnswers)) {
        const cloudCompact = finalAnswers[qid];
        if (!cloudCompact || getItemTime(localCompact) >= getItemTime(cloudCompact)) {
          finalAnswers[qid] = localCompact;
        }
      }

      for (const [qid, item] of Object.entries(cloudMistakes)) {
        if (!validQid(qid)) continue;
        const compact = toCompactMistake(item);
        if (compact) finalMistakes[qid] = compact;
      }
      for (const [qid, localCompact] of Object.entries(sanitizedLocalMistakes)) {
        const cloudCompact = finalMistakes[qid];
        if (!cloudCompact || getItemTime(localCompact) >= getItemTime(cloudCompact)) {
          finalMistakes[qid] = localCompact;
        }
      }
    }

    const answersJson = JSON.stringify(finalAnswers);
    const mistakesJson = JSON.stringify(finalMistakes);

    // 服务端二次拦截：如果数据库中已有记录，且内容完全一致，跳过 D1 写入，节约写入配额！
    if (hasCloudRow && existing.answers_data === answersJson && existing.mistakes_data === mistakesJson) {
      return jsonResponse({
        success: true,
        notModified: true,
        bankId,
        version: cloudVersion,
        answers: finalAnswers,
        mistakes: finalMistakes,
        updatedAt: existing.updated_at || Date.now(),
        message: '数据与云端一致，无需重复写入'
      });
    }

    const now = Date.now();
    const nextVersion = hasCloudRow ? cloudVersion + 1 : 1;

    // 写入 D1：单行原子 UPSERT，按 (user_id, bank_id) 隔离
    await env.DB.prepare(
      `INSERT INTO user_progress (user_id, bank_id, answers_data, mistakes_data, stats_data, version, updated_at)
       VALUES (?, ?, ?, ?, '{}', ?, ?)
       ON CONFLICT(user_id, bank_id) DO UPDATE SET
         answers_data = excluded.answers_data,
         mistakes_data = excluded.mistakes_data,
         version = excluded.version,
         updated_at = excluded.updated_at`
    ).bind(authUser.id, bankId, answersJson, mistakesJson, nextVersion, now).run();

    return jsonResponse({
      success: true,
      bankId,
      version: nextVersion,
      answers: finalAnswers,
      mistakes: finalMistakes,
      updatedAt: now,
      message: '云端做题数据保存成功'
    });
  } catch (err) {
    return handleError(err, 'progress/sync:post');
  }
}
