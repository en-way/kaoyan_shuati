/**
 * 云端 D1 数据库零停机自愈无损迁移模块 (functions/utils/db-migrate.js)
 *
 * 作用：
 * - 在 Worker Isolate 内存中缓存 _schemaVerified 标记，每个实例生命周期仅执行 1 次表结构探针，后续请求 0 额外 D1 开销。
 * - 若检测到线上 user_progress 表仍为 v37 单主键结构（缺少 bank_id 列），自动通过 db.batch 原子完成：
 *   建新表 user_progress_new (PRIMARY KEY (user_id, bank_id)) -> 全量拷贝旧表数据并赋予 bank_id = '2027_1000' -> 切换表名。
 */
import { DEFAULT_BANK_ID } from './validate.js';

let _schemaVerified = false;

export function resetMigrationCacheForTest() {
  _schemaVerified = false;
}

export async function ensureMultiBankSchema(db) {
  if (_schemaVerified || !db || typeof db.prepare !== 'function') {
    return;
  }

  try {
    const infoStmt = db.prepare('PRAGMA table_info(user_progress)');
    const infoRes = typeof infoStmt.all === 'function' ? await infoStmt.all() : null;
    const cols = (infoRes && Array.isArray(infoRes.results)) ? infoRes.results : [];

    // 若未返回列信息（如单元测试轻量 Mock 未实现 PRAGMA）或已包含 bank_id 列，直接标记已验证
    if (cols.length === 0 || cols.some(c => c && c.name === 'bank_id')) {
      _schemaVerified = true;
      return;
    }

    // 检测到旧版 v37 单主键表（存在 user_id 列但无 bank_id 列） -> 执行原子无损升级
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

    _schemaVerified = true;
  } catch (err) {
    // 迁移探针不阻断主流程
    console.warn('[D1 Auto-Migrate] Schema check notice:', err && err.message ? err.message : err);
  }
}
