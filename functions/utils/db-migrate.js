/**
 * 云端 D1 数据库零停机自愈无损迁移模块 (functions/utils/db-migrate.js)
 *
 * 作用：
 * - 在 Worker Isolate 内存中缓存 _schemaVerified 标记与 _migrationPromise 单飞锁：
 *   1) 自动兼容并迁移旧版单主键 user_progress 至 (user_id, bank_id) 复合主键；
 *   2) 为存量 users 表幂等补齐 token_version、hash_iters 字段；
 *   3) 确保 auth_rate_limits 防爆破限流表存在。
 */
import { DEFAULT_BANK_ID } from './validate.js';
import { PBKDF2_ITERATIONS } from './constants.js';

let _schemaVerified = false;
let _migrationPromise = null;

export function resetMigrationCacheForTest() {
  _schemaVerified = false;
  _migrationPromise = null;
}

export async function ensureMultiBankSchema(db) {
  if (_schemaVerified || !db || typeof db.prepare !== 'function') {
    return;
  }
  if (_migrationPromise) {
    return _migrationPromise;
  }

  _migrationPromise = (async () => {
    try {
      const infoStmt = db.prepare('PRAGMA table_info(user_progress)');
      const infoRes = typeof infoStmt.all === 'function' ? await infoStmt.all() : null;
      const cols = (infoRes && Array.isArray(infoRes.results)) ? infoRes.results : [];

      // 检测到旧版 v37 单主键表（存在 user_id 列但无 bank_id 列） -> 执行原子无损升级
      if (cols.length > 0 && !cols.some(c => c && c.name === 'bank_id')) {
        if (typeof db.batch === 'function') {
          await db.batch([
            db.prepare(`
              CREATE TABLE IF NOT EXISTS user_progress_new (
                user_id TEXT NOT NULL,
                bank_id TEXT NOT NULL DEFAULT '${DEFAULT_BANK_ID}',
                answers_data TEXT NOT NULL,
                mistakes_data TEXT NOT NULL,
                stats_data TEXT,
                version INTEGER DEFAULT 1,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, bank_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
              )
            `),
            db.prepare(`
              INSERT OR IGNORE INTO user_progress_new (user_id, bank_id, answers_data, mistakes_data, stats_data, version, updated_at)
              SELECT
                user_id,
                '${DEFAULT_BANK_ID}' AS bank_id,
                COALESCE(answers_data, '{}'),
                COALESCE(mistakes_data, '{}'),
                COALESCE(stats_data, '{}'),
                COALESCE(version, 1),
                COALESCE(updated_at, 0)
              FROM user_progress
            `),
            db.prepare('DROP TABLE user_progress'),
            db.prepare('ALTER TABLE user_progress_new RENAME TO user_progress')
          ]);
        }
      }

      // 幂等检查 users 表列与 auth_rate_limits 表（仅对支持 PRAGMA 的真实 D1/完整 Mock 生效，保持轻量 Mock 0 干扰）
      const usersInfoStmt = db.prepare('PRAGMA table_info(users)');
      const usersInfoRes = typeof usersInfoStmt.all === 'function' ? await usersInfoStmt.all() : null;
      const userCols = (usersInfoRes && Array.isArray(usersInfoRes.results)) ? usersInfoRes.results : [];

      if (userCols.length > 0) {
        const alterOps = [];
        if (!userCols.some(c => c && c.name === 'token_version')) {
          alterOps.push(db.prepare('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1'));
        }
        if (!userCols.some(c => c && c.name === 'hash_iters')) {
          alterOps.push(db.prepare(`ALTER TABLE users ADD COLUMN hash_iters INTEGER NOT NULL DEFAULT ${PBKDF2_ITERATIONS}`));
        }
        alterOps.push(db.prepare(`
          CREATE TABLE IF NOT EXISTS auth_rate_limits (
            bucket TEXT PRIMARY KEY,
            fail_count INTEGER NOT NULL DEFAULT 0,
            window_start INTEGER NOT NULL,
            locked_until INTEGER NOT NULL DEFAULT 0
          )
        `));

        if (typeof db.batch === 'function') {
          await db.batch(alterOps);
        } else {
          for (const op of alterOps) {
            if (typeof op.run === 'function') await op.run();
          }
        }
      }

      _schemaVerified = true;
    } catch (err) {
      // 迁移失败时不置 _schemaVerified = true，允许后续请求重试
      console.warn('[D1 Auto-Migrate] Schema check notice:', err && err.message ? err.message : err);
    } finally {
      _migrationPromise = null;
    }
  })();

  return _migrationPromise;
}
