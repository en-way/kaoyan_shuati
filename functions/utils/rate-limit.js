/**
 * D1 轻量级防爆破限流工具 (functions/utils/rate-limit.js)
 * 使用 auth_rate_limits 表按 IP / 账号统计短时失败次数，阻止暴力破解与刷量。
 */
import { HttpError, ErrorCode } from './http.js';

export function getClientIp(request) {
  if (!request || !request.headers) return 'unknown';
  const cfIp = (request.headers.get('cf-connecting-ip') || '').trim();
  if (cfIp) return cfIp.slice(0, 64);
  const xff = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (xff) return xff.slice(0, 64);
  return 'unknown';
}

/**
 * 检查限流桶是否处于锁定期；若处于锁定窗口内直接抛出 429 RATE_LIMITED。
 */
export async function assertNotRateLimited(db, bucket, now = Date.now()) {
  if (!db || typeof db.prepare !== 'function' || !bucket) return;
  try {
    const row = await db.prepare(
      'SELECT fail_count, window_start, locked_until FROM auth_rate_limits WHERE bucket = ?'
    ).bind(bucket).first();
    if (row && Number.isFinite(row.locked_until) && row.locked_until > now) {
      const waitMinutes = Math.max(1, Math.ceil((row.locked_until - now) / 60000));
      throw new HttpError(
        429,
        `尝试过于频繁，请 ${waitMinutes} 分钟后再试`,
        ErrorCode.RATE_LIMITED
      );
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
  }
}

/**
 * 记录一次失败尝试（或计次事件）；达到 maxFails 阈值后自动锁定 lockMs。
 */
export async function recordRateLimitAttempt(db, bucket, policy, now = Date.now()) {
  if (!db || typeof db.prepare !== 'function' || !bucket || !policy) return;
  const { maxFails, windowMs, lockMs } = policy;
  try {
    const existing = await db.prepare(
      'SELECT fail_count, window_start, locked_until FROM auth_rate_limits WHERE bucket = ?'
    ).bind(bucket).first();

    let nextFails = 1;
    let nextWindowStart = now;
    if (existing && Number.isFinite(existing.window_start) && (now - existing.window_start) <= windowMs) {
      nextFails = (existing.fail_count || 0) + 1;
      nextWindowStart = existing.window_start;
    }

    const nextLockedUntil = nextFails >= maxFails ? (now + lockMs) : 0;
    await db.prepare(
      `INSERT INTO auth_rate_limits (bucket, fail_count, window_start, locked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(bucket) DO UPDATE SET
         fail_count = excluded.fail_count,
         window_start = excluded.window_start,
         locked_until = excluded.locked_until`
    ).bind(bucket, nextFails, nextWindowStart, nextLockedUntil).run();
  } catch (_) {}
}

/**
 * 认证成功后清理对应限流桶
 */
export async function clearRateLimit(db, bucket) {
  if (!db || typeof db.prepare !== 'function' || !bucket) return;
  try {
    await db.prepare('DELETE FROM auth_rate_limits WHERE bucket = ?').bind(bucket).run();
  } catch (_) {}
}
